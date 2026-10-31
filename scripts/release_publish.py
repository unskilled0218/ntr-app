"""Guarded Forgejo artifact publication. Never repairs uncertain remote writes."""

import argparse
import contextlib
import fcntl
import http.client
import os
from pathlib import Path
import re
import signal
import shutil
import ssl
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from release_model import (Refusal, canonical, decode, digest, file_digest, identity,
                           manifest, payload_read, private_file, require, settings)


FINGERPRINT_GUIDANCE = (
  "From the app repository root, run `bash scripts/android-keystore.sh --fingerprint` "
  "for your existing trusted signing key, then set `android_certificate_sha256` in "
  "`scripts/release.json` after confirming that identity. "
  "See `docs/android-signing.md#trusted-certificate` for signing-file setup and trust guidance."
)


WAIT_INTERVAL = 15
BUILD_LABELS = {
  ("android",): "build (android)",
  ("desktop",): "build (desktop)",
  ("android", "desktop"): "build (android, desktop)",
}
TOOL_LABELS = {"dependency installation", "JavaScript tests", "Rust tests", *BUILD_LABELS.values()}


def progress(message):
  """Only pass curated labels or validated manifest names, never tool output."""
  print(f"Release: {message}", file=sys.stderr, flush=True)


@contextlib.contextmanager
def stage(label):
  progress(f"Starting {label}")
  started = time.monotonic()
  try:
    yield
  except Refusal as error:
    raise Refusal(f"{label}: {error}") from None
  except (OSError, ValueError, KeyError, TypeError, http.client.HTTPException):
    raise Refusal(f"{label}: operation failed; private details withheld") from None
  else:
    progress(f"Completed {label} ({int(time.monotonic() - started)}s)")


def run(args, cwd, timeout=120, input_data=None, progress_label=None):
  if progress_label is None:
    return captured_run(args, cwd, timeout, input_data)
  require(progress_label in TOOL_LABELS, "Invalid tool progress label")
  with stage(progress_label):
    return captured_run(args, cwd, timeout, input_data, progress_label)


def captured_run(args, cwd, timeout, input_data, progress_label=None):
  """Keep tool output private; only return bounded captured output to callers."""
  with tempfile.TemporaryFile() as output:
    try:
      if progress_label is None:
        result = subprocess.run(args, cwd=cwd, input=input_data, stdout=output,
                                stderr=subprocess.STDOUT, timeout=timeout, check=False)
        returncode = result.returncode
      else:
        started = time.monotonic()
        process = subprocess.Popen(args, cwd=cwd, stdin=subprocess.PIPE if input_data is not None else None,
                                   stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
        try:
          while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
              raise subprocess.TimeoutExpired(args, timeout)
            try:
              process.communicate(input=input_data, timeout=min(WAIT_INTERVAL, remaining))
              break
            except subprocess.TimeoutExpired:
              input_data = None
              require(os.fstat(output.fileno()).st_size <= 16 * 1024**2, "Tool output limit exceeded")
              elapsed = time.monotonic() - started
              if elapsed >= timeout:
                raise
              progress(f"Waiting for {progress_label} ({int(elapsed)}s elapsed)")
          returncode = process.returncode
        except BaseException:
          # The command owns its session; stop descendants too, even if the parent exited.
          try:
            os.killpg(process.pid, signal.SIGKILL)
          except ProcessLookupError:
            pass
          process.wait()
          raise
    except (OSError, subprocess.TimeoutExpired) as error:
      name = progress_label or Path(args[0]).name
      raise Refusal(f"Tool unavailable or timed out: {name}") from error
    name = progress_label or Path(args[0]).name
    require(returncode == 0, f"Tool failed: {name}; output withheld to protect credentials")
    require(output.tell() <= 16 * 1024**2, "Tool output limit exceeded")
    output.seek(0)
    return output.read().decode("utf-8", errors="strict")


def git(root, *args):
  return run(["git", "-c", "core.hooksPath=/dev/null", "-c", "credential.interactive=false", *args], root).strip()


def environment_check():
  forbidden = ("FORGEJO_", "GIT_CONFIG", "GIT_SSL", "GIT_SSH", "GIT_PROXY", "GIT_EXEC", "GIT_OBJECT", "GIT_ALTERNATE", "GIT_REPLACE")
  exact = {"GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_NAMESPACE", "LD_PRELOAD", "PYTHONPATH"}
  for name in os.environ:
    require(not name.startswith(forbidden) and name not in exact, f"Unsupported environment override: {name}")
  os.environ["GIT_TERMINAL_PROMPT"] = "0"


def source(root, config):
  require(git(root, "branch", "--show-current") == "main", "Publication/verification requires main")
  require(not git(root, "status", "--porcelain", "--untracked-files=all"), "Checkout must be clean")
  require(not git(root, "ls-files", "android-signing"), "Signing files must not be tracked")
  require(git(root, "rev-parse", "--show-toplevel") == str(root), "Unexpected repository root")
  require(not git(root, "replace", "-l"), "Git replacement objects are refused")
  expected_host = urllib.parse.urlsplit(config["gitea"]).hostname
  repository = config["repository"]
  for push in (False, True):
    args = ["remote", "get-url", "--all"] + (["--push"] if push else []) + ["origin"]
    urls = git(root, *args).splitlines()
    require(len(urls) == 1, "Exactly one fetch and push destination required")
    url = urls[0]
    allowed = {f"{config['gitea']}/{repository}.git", f"git@{expected_host}:{repository}.git",
               f"ssh://git@{expected_host}/{repository}.git"}
    require(url in allowed, "Git remote does not match configured repository")
  for line in git(root, "config", "--list").splitlines():
    key, _, value = line.lower().partition("=")
    require(key not in ("core.sshcommand", "remote.origin.receivepack", "remote.origin.uploadpack"), "Unsafe Git transport command override")
    if key.startswith("http."):
      require(not (key.endswith("sslverify") and value in ("false", "0", "no", "off")), "Unsafe Git TLS configuration")
      require(not key.endswith("extraheader"), "Git HTTP credential header overrides are refused")
      require(not key.endswith("followredirects") or value in ("false", "0", "no", "off"), "Git redirects must be disabled or use defaults")
  commit = git(root, "rev-parse", "HEAD")
  remote_main = git(root, "ls-remote", "--refs", "origin", "refs/heads/main").split()
  require(remote_main == [commit, "refs/heads/main"], "main must already be pushed and match remote main")
  return commit


class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
  def redirect_request(self, req, fp, code, msg, headers, newurl):
    old, new = urllib.parse.urlsplit(req.full_url), urllib.parse.urlsplit(newurl)
    require(req.get_method() == "GET" and (new.scheme, new.netloc) == (old.scheme, old.netloc)
            and not new.username and not new.password, "Untrusted redirect refused; credentials were not forwarded")
    return super().redirect_request(req, fp, code, msg, headers, newurl)


class Forgejo:
  """HTTPS-only, same-origin, bounded requests without automatic write retries."""

  def __init__(self, config, token):
    self.origin = config["gitea"]
    self.base = f"{self.origin}/api/v1/repos/{config['repository']}"
    self.token = token
    self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), SameOriginRedirect())

  def open(self, url, method="GET", data=None):
    parsed, origin = urllib.parse.urlsplit(url), urllib.parse.urlsplit(self.origin)
    require((parsed.scheme, parsed.netloc) == (origin.scheme, origin.netloc)
            and not parsed.username and not parsed.password and not parsed.fragment, "Untrusted asset URL")
    headers = {"Authorization": f"token {self.token}", "Accept": "application/json"}
    if data is not None:
      headers["Content-Type"] = "application/json"
      data = canonical(data).encode()
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
      return self.opener.open(request, timeout=60)
    except urllib.error.HTTPError as error:
      if error.code == 404 and method == "GET":
        error.close()
        return None
      error.close()
      raise Refusal(f"Forgejo {method} failed with HTTP {error.code}; writes may be uncertain") from None
    except (OSError, urllib.error.URLError) as error:
      raise Refusal(f"Forgejo {method} failed; do not blindly repeat uncertain writes") from None

  def json(self, url, method="GET", data=None):
    response = self.open(url, method, data)
    if response is None:
      return None
    with response:
      require(response.status == (201 if method == "POST" else 200), "Unexpected API status")
      raw = response.read(2 * 1024**2 + 1)
      require(len(raw) <= 2 * 1024**2, "API metadata too large")
      return decode(raw)

  def preflight(self, config):
    version = self.json(self.origin + "/api/v1/version")
    require(isinstance(version, dict) and isinstance(version.get("version"), str)
            and re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", version["version"]), "Unsupported Forgejo version response")
    user = self.json(self.origin + "/api/v1/user")
    require(isinstance(user, dict) and user.get("login") == config["username"], "Token owner does not match configured username")
    repo = self.json(self.base)
    require(isinstance(repo, dict) and repo.get("full_name") == config["repository"]
            and isinstance(repo.get("permissions"), dict) and repo["permissions"].get("push") is True,
            "Repository identity or write permissions could not be verified")

  def release(self, tag):
    return self.json(self.base + "/releases/tags/" + tag)

  def assets(self, release_id):
    result = []
    for page in range(1, 102):
      batch = self.json(f"{self.base}/releases/{release_id}/assets?limit=50&page={page}")
      require(isinstance(batch, list) and len(batch) <= 50, "Invalid asset pagination")
      result.extend(batch)
      require(len(result) <= 100, "Too many assets")
      if len(batch) < 50:
        return result
    raise Refusal("Asset pagination did not terminate")

  def asset_digest(self, url, expected_size):
    import hashlib
    response = self.open(url)
    require(response is not None, "Asset download missing")
    value = hashlib.sha256()
    size = 0
    with response:
      require(response.status == 200, "Unexpected download status")
      while True:
        chunk = response.read(min(1024 * 1024, expected_size + 1 - size))
        if not chunk:
          break
        size += len(chunk)
        require(size <= expected_size, "Oversized asset download")
        value.update(chunk)
    require(size == expected_size, "Truncated asset download")
    return value.hexdigest()

  def upload(self, release_id, path):
    boundary = "ntr-" + os.urandom(24).hex()
    prefix = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"attachment\"; filename=\"{path.name}\"\r\n"
              "Content-Type: application/octet-stream\r\n\r\n").encode()
    suffix = f"\r\n--{boundary}--\r\n".encode()
    url = urllib.parse.urlsplit(self.base + f"/releases/{release_id}/assets?name=" + urllib.parse.quote(path.name))
    connection = http.client.HTTPSConnection(url.hostname, url.port, timeout=120, context=ssl.create_default_context())
    try:
      connection.putrequest("POST", url.path + "?" + url.query)
      connection.putheader("Authorization", f"token {self.token}")
      connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
      connection.putheader("Content-Length", str(len(prefix) + path.stat().st_size + len(suffix)))
      connection.endheaders()
      connection.send(prefix)
      with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
          connection.send(chunk)
      connection.send(suffix)
      response = connection.getresponse()
      require(response.status == 201, "Asset upload failed/uncertain; inspect remote state")
      raw = response.read(2 * 1024**2 + 1)
      require(len(raw) <= 2 * 1024**2, "Upload response too large")
      asset = decode(raw)
      require(isinstance(asset, dict) and asset.get("name") == path.name and type(asset.get("id")) is int
              and asset["id"] > 0, "Invalid upload response")
    except (OSError, http.client.HTTPException):
      raise Refusal("Upload outcome uncertain; inspect remote state without rollback") from None
    finally:
      connection.close()


def remote_tag(root, tag):
  lines = git(root, "ls-remote", "origin", f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}").splitlines()
  records = {}
  for line in lines:
    parts = line.split()
    require(len(parts) == 2 and re.fullmatch(r"[0-9a-f]{40}", parts[0]) and parts[1] not in records, "Invalid tag evidence")
    records[parts[1]] = parts[0]
  if not records:
    return None
  require(set(records) == {f"refs/tags/{tag}", f"refs/tags/{tag}^{{}}"}, "Annotated remote tag required")
  return records[f"refs/tags/{tag}"], records[f"refs/tags/{tag}^{{}}"]


def read_tag(root, tag, observed):
  git(root, "fetch", "--no-tags", "origin", f"refs/tags/{tag}")
  require(git(root, "rev-parse", "FETCH_HEAD") == observed[0], "Tag changed during fetch")
  text = run(["git", "cat-file", "tag", observed[0]], root)
  headers, body = text.split("\n\n", 1)
  require(f"object {observed[1]}" in headers.splitlines() and "type commit" in headers.splitlines()
          and f"tag {tag}" in headers.splitlines(), "Invalid annotated tag")
  return body.removesuffix("\n")


def release_metadata_check(record, tag, source_commit, notes):
  require(isinstance(record, dict) and type(record.get("id")) is int and record["id"] > 0, "Invalid release record")
  require(record.get("tag_name") == tag and record.get("name") == tag and record.get("body") == notes
          and record.get("draft") is False and record.get("prerelease") is False
          and record.get("target_commitish") in (source_commit, "main"), "Release metadata mismatch")


def release_check(api, record, tag, expected, notes):
  release_metadata_check(record, tag, expected["source"], notes)
  assets = api.assets(record["id"])
  by_name = {}
  ids = set()
  for asset in assets:
    require(isinstance(asset, dict) and isinstance(asset.get("name"), str) and asset["name"] not in by_name
            and type(asset.get("id")) is int and asset["id"] > 0 and asset["id"] not in ids, "Duplicate or malformed remote asset")
    by_name[asset["name"]] = asset
    ids.add(asset["id"])
  require(set(by_name) == {e["name"] for e in expected["manifest"]}, "Remote inventory differs from original manifest")
  for index, entry in enumerate(expected["manifest"], 1):
    asset = by_name[entry["name"]]
    require(type(asset.get("size")) is int and asset["size"] == entry["size"], "Remote asset size mismatch")
    # The asset API returns JSON metadata, not bytes. Download the attachment URL.
    url = asset.get("browser_download_url")
    require(isinstance(url, str), "Missing attachment download URL")
    parsed = urllib.parse.urlsplit(url)
    repository = urllib.parse.urlsplit(api.base).path.removeprefix("/api/v1/repos/")
    require(parsed.path.startswith(f"/{repository}/releases/download/{tag}/")
            or re.fullmatch(r"/attachments/[A-Za-z0-9-]+", parsed.path), "Unsupported attachment download route")
    with stage(f"asset verification {index}/{len(expected['manifest'])}: {entry['name']}"):
      require(api.asset_digest(url, entry["size"]) == entry["sha256"], "Remote asset digest mismatch")
  return sorted((a["id"], a["name"], a["size"], a["browser_download_url"]) for a in assets)


def stable_release(record):
  require(isinstance(record, dict), "Release disappeared during verification")
  return {k: record.get(k) for k in ("id", "tag_name", "name", "body", "draft", "prerelease", "target_commitish")}


def verify_complete(root, api, tag, observed, record, expected, notes):
  require(observed and record is not None, "Partial release state; inspect without rollback")
  require(observed[1] == expected["source"], "Tag source differs from requested source")
  with stage("tag identity verification"):
    payload = payload_read(read_tag(root, tag, observed), expected)
  inventory = release_check(api, record, tag, payload, notes)
  with stage("remote stability checks"):
    after = api.assets(record["id"])
    require(sorted((a["id"], a["name"], a["size"], a["browser_download_url"]) for a in after) == inventory,
            "Asset inventory changed during verification")
    # Download counters/timestamps may change as a result of our own GETs.
    require(remote_tag(root, tag) == observed and stable_release(api.release(tag)) == stable_release(record),
            "Release changed during verification")


def apk_check(path, fingerprint, cwd):
  require(fingerprint is not None, "Set trusted android_certificate_sha256 before Android publication. " + FINGERPRINT_GUIDANCE)
  output = run(["apksigner", "verify", "--verbose", "--print-certs", str(path)], cwd)
  signers = re.findall(r"^Signer #[0-9]+ certificate SHA-256 digest: ([0-9a-fA-F]{64})$", output, re.MULTILINE)
  require([s.lower() for s in signers] == [fingerprint], "APK signing certificate mismatch")


def signing_copy(root, checkout):
  directory = root / "android-signing"
  require(not directory.is_symlink() and directory.resolve() == directory and directory.stat().st_uid == os.getuid()
          and directory.stat().st_mode & 0o777 == 0o700, "Signing directory must be user-owned mode 0700 without symlinks")
  destination = checkout / "android-signing"
  destination.mkdir(mode=0o700)
  for name in ("release.keystore", "keystore.properties"):
    path = private_file(directory / name)
    require(git(root, "check-ignore", "--", str(path)) == str(path), "Signing files must be ignored")
    shutil.copyfile(path, destination / name)
    (destination / name).chmod(0o600)


def unchanged(checkout, commit):
  require(git(checkout, "rev-parse", "HEAD") == commit and not git(checkout, "diff", "HEAD", "--"), "Build changed tracked source")
  require(not git(checkout, "ls-files", "--others", "--exclude-standard"), "Build introduced untracked source")


@contextlib.contextmanager
def build(root, config, version, commit, targets):
  for tool in ("npm", "node", "cargo") + (("apksigner",) if "android" in targets else ()):
    require(shutil.which(tool), f"Install required build tool: {tool}")
  if "android" in targets:
    require(config["android_certificate_sha256"] is not None, "Set trusted Android certificate fingerprint before building. " + FINGERPRINT_GUIDANCE)
  with tempfile.TemporaryDirectory(prefix="ntr-release-") as temporary:
    checkout = Path(temporary) / "source"
    with stage("isolated checkout creation"):
      git(root, "clone", "--no-hardlinks", "--no-local", "--no-checkout", str(root), str(checkout))
      git(checkout, "checkout", "--detach", commit)
    run(["npm", "ci"], checkout, 1200, progress_label="dependency installation")
    with stage("source checks after dependency installation"):
      unchanged(checkout, commit)
    run(["npm", "test"], checkout, 1200, progress_label="JavaScript tests")
    run(["cargo", "test", "--locked", "--lib", "--manifest-path", "src-tauri/Cargo.toml"], checkout, 1200,
        progress_label="Rust tests")
    with stage("source checks after tests"):
      unchanged(checkout, commit)
    if "android" in targets:
      with stage("private Android signing setup"):
        signing_copy(root, checkout)
    run(["bash", "scripts/build-release.sh", *targets], checkout, 7200,
        progress_label=BUILD_LABELS[tuple(sorted(targets))])
    with stage("source checks after build"):
      unchanged(checkout, commit)
    output = checkout / "release" / version
    with stage("artifact validation and checksums"):
      entries, paths = manifest(output, targets)
    for path in paths.values():
      if path.suffix == ".apk":
        with stage("Android certificate verification"):
          apk_check(path, config["android_certificate_sha256"], checkout)
    yield entries, paths


def publish(root, config, version, notes, targets, api):
  with stage("source validation"):
    commit = source(root, config)
    expected = identity(root, config, version, commit, targets)
  tag = "v" + version
  with stage("Forgejo preflight"):
    api.preflight(config)
  with stage("remote release inspection"):
    observed, record = remote_tag(root, tag), api.release(tag)
  if observed or record is not None:
    with stage("existing-release read-only verification; no build or remote writes"):
      verify_complete(root, api, tag, observed, record, expected, notes)
    with stage("source recheck after verification"):
      current_config, current_version, _ = settings(root)
      require(source(root, current_config) == commit and identity(root, current_config, current_version, commit, targets) == expected,
              "Source/settings changed during verification")
    print(f"Existing release verified: {tag}; no build or remote writes")
    return
  with stage("local tag inspection"):
    require(not git(root, "tag", "--list", tag), "Unpublished local tag exists; inspect without rollback")
  with build(root, config, version, commit, targets) as (entries, paths):
    with stage("source and remote rechecks before publication"):
      require(source(root, config) == commit and identity(root, *settings(root)[:2], commit, targets) == expected, "Source/settings changed during build")
      require(remote_tag(root, tag) is None and api.release(tag) is None, "Remote release appeared during build")
      payload = {**expected, "manifest": entries}
      payload_read(canonical(payload), expected)
    progress("Publication; failures may leave partial remote state")
    with stage("local tag creation"):
      git(root, "-c", "tag.gpgSign=false", "tag", "-a", "--cleanup=verbatim", tag, commit, "-m", canonical(payload))
      oid = git(root, "rev-parse", f"refs/tags/{tag}")
    with stage("tag push"):
      git(root, "-c", "push.followTags=false", "push", "--no-follow-tags", "origin", f"refs/tags/{tag}:refs/tags/{tag}")
    with stage("remote recheck before release creation"):
      require(remote_tag(root, tag) == (oid, commit) and api.release(tag) is None, "Tag/release changed before release creation")
    with stage("release creation"):
      record = api.json(api.base + "/releases", "POST", {"tag_name": tag, "target_commitish": commit,
                        "name": tag, "body": notes, "draft": False, "prerelease": False})
      release_metadata_check(record, tag, commit, notes)
    uploaded = set()
    for index, (name, path) in enumerate(sorted(paths.items()), 1):
      with stage(f"asset upload {index}/{len(paths)}: {name}"):
        require(remote_tag(root, tag) == (oid, commit), "Tag changed before asset write")
        require(stable_release(api.release(tag)) == stable_release(record), "Release metadata changed before asset write")
        remote_assets = api.assets(record["id"])
        require(len(remote_assets) == len(uploaded) and {a.get("name") for a in remote_assets} == uploaded,
                "Asset inventory changed before upload")
        require(file_digest(path) == next(e["sha256"] for e in entries if e["name"] == name), "Artifact changed before upload")
        api.upload(record["id"], path)
        uploaded.add(name)
    with stage("published release verification"):
      verify_complete(root, api, tag, (oid, commit), api.release(tag), expected, notes)
    print(f"Release verified: {tag}")


def main():
  parser = argparse.ArgumentParser(description="Build/publish a new release, or read-only verify an existing complete release. No automatic recovery.")
  parser.add_argument("--validate", action="store_true", help="Validate local metadata without credentials or network")
  parser.add_argument("targets", nargs="*", choices=None, help="desktop and/or android; default: configured targets")
  args = parser.parse_args()
  root = Path(__file__).resolve().parent.parent
  os.umask(0o077)
  with contextlib.nullcontext() if args.validate else stage("local configuration checks"):
    environment_check()
    config, version, notes = settings(root)
    targets = args.targets or config["targets"]
    require(len(set(targets)) == len(targets) and all(t in config["targets"] for t in targets), "Invalid/duplicate target selection")
  if args.validate:
    require(not args.targets, "--validate does not accept targets")
    print("Local configuration and version mirrors valid; no credentials or network used")
    if config["android_certificate_sha256"] is None:
      print("Android publication blocked until trusted certificate fingerprint is configured. " + FINGERPRINT_GUIDANCE, file=sys.stderr)
    return
  with stage("private credential checks"):
    token_path = private_file(os.environ.get("GIT_TOKEN", config["token_file"]), outside=root)
    require(token_path.stat().st_size <= 4096, "Token file too large")
    token = token_path.read_text().strip()
    require(re.fullmatch(r"[A-Za-z0-9_-]{16,4096}", token), "Invalid token file content")
    if "GIT_USERNAME" in os.environ:
      require(os.environ["GIT_USERNAME"] == config["username"], "GIT_USERNAME must match configured owner")
  progress("Acquiring local release lock")
  lock_path = Path(git(root, "rev-parse", "--git-path", "app-release.lock"))
  if not lock_path.is_absolute():
    lock_path = root / lock_path
  fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
  with os.fdopen(fd, "w") as lock:
    try:
      fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
      raise Refusal("Another release process holds the local lock") from None
    publish(root, config, version, notes, sorted(targets), Forgejo(config, token))


def cli():
  try:
    main()
    return 0
  except KeyboardInterrupt:
    print("Release stopped: interrupted. Inspect partial state without rollback or blind retries.", file=sys.stderr, flush=True)
    return 130
  except (Refusal, OSError, ValueError, KeyError, TypeError, http.client.HTTPException) as error:
    # Do not echo exception text from third-party tools, URLs, or remote bodies.
    message = str(error) if isinstance(error, Refusal) else "Invalid local metadata or failed operation"
    print(f"Release stopped: {message}. Inspect partial state without rollback or blind retries.", file=sys.stderr, flush=True)
    return 1


if __name__ == "__main__":
  sys.exit(cli())
