"""Offline release contracts; real temporary Git repositories, no live publication."""

import contextlib
import copy
import fcntl
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import release_model as model
import release_publish as publisher
import android_signing as signing


def command(root, *args):
  result = subprocess.run(args, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
  return result.stdout.decode().strip()


class FakeForgejo:
  """Model API records and actual downloaded bytes, including uncertain writes."""

  def __init__(self):
    self.base = "https://git.lan/api/v1/repos/ntr/ntr-app"
    self.record = None
    self.files = {}
    self.writes = []
    self.fault = None

  def preflight(self, config):
    pass

  def release(self, tag):
    return copy.deepcopy(self.record)

  def json(self, url, method, data):
    self.writes.append("release")
    self.record = {**data, "id": 1}
    if self.fault == "release-lost":
      raise model.Refusal("Lost release response")
    return copy.deepcopy(self.record)

  def upload(self, release_id, path):
    self.writes.append(path.name)
    self.files[path.name] = path.read_bytes()
    if self.fault in ("upload-lost", path.suffix):
      raise model.Refusal("Lost upload response")

  def assets(self, release_id):
    return [{"id": i + 1, "name": name, "size": len(data),
             "browser_download_url": "https://git.lan/attachments/asset-" + str(i + 1)}
            for i, (name, data) in enumerate(sorted(self.files.items()))]

  def asset_digest(self, url, size):
    index = int(url.rsplit("-", 1)[1]) - 1
    value = sorted(self.files.items())[index][1]
    model.require(len(value) == size, "Download size mismatch")
    return model.digest(value)


class Fixture:
  def __enter__(self):
    self.temp = tempfile.TemporaryDirectory(prefix="ntr-release-test-")
    self.base = Path(self.temp.name)
    self.root = self.base / "app"
    self.root.mkdir()
    self.remote = self.base / "remote.git"
    command(self.base, "git", "init", "--bare", str(self.remote))
    command(self.root, "git", "init", "-b", "main")
    command(self.root, "git", "config", "user.name", "Release tests")
    command(self.root, "git", "config", "user.email", "release@example.invalid")
    command(self.root, "git", "remote", "add", "origin", str(self.remote))
    for name in ("scripts", "src-tauri", "docs/releases"):
      (self.root / name).mkdir(parents=True, exist_ok=True)
    for path in (ROOT / "scripts").iterdir():
      if path.is_file():
        shutil.copyfile(path, self.root / "scripts" / path.name)
    notes_path = json.loads((ROOT / "scripts/release.json").read_text())["notes"]
    for name in ("package.json", "package-lock.json", ".gitignore", "src-tauri/tauri.conf.json",
                 "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", notes_path):
      shutil.copyfile(ROOT / name, self.root / name)
    config = model.decode((self.root / "scripts/release.json").read_bytes())
    config["android_certificate_sha256"] = "a" * 64
    (self.root / "scripts/release.json").write_text(json.dumps(config))
    command(self.root, "git", "add", ".")
    command(self.root, "git", "commit", "-m", "fixture")
    command(self.root, "git", "push", "origin", "main")
    self.commit = publisher.git(self.root, "rev-parse", "HEAD")
    self.config, self.version, self.notes = model.settings(self.root)
    self.api = FakeForgejo()
    return self

  def __exit__(self, *args):
    self.temp.cleanup()

  def source(self, root, config):
    # Real Git source checks, except transport identity: this fixture's remote is local.
    model.require(publisher.git(root, "branch", "--show-current") == "main", "Wrong branch")
    model.require(not publisher.git(root, "status", "--porcelain"), "Dirty source")
    current = publisher.git(root, "rev-parse", "HEAD")
    model.require(publisher.git(root, "ls-remote", "origin", "refs/heads/main").split()[0] == current, "Unpushed source")
    return current

  @contextlib.contextmanager
  def build(self, root, config, version, commit, targets):
    with tempfile.TemporaryDirectory(dir=self.base) as temporary:
      output = Path(temporary)
      for target in targets:
        (output / target).mkdir()
        for suffix in model.FORMATS[target]:
          (output / target / ("ntr" + suffix)).write_bytes(b"fresh artifact " + suffix.encode())
      yield model.manifest(output, targets)

  def publish(self, targets=("android",)):
    with patch.object(publisher, "source", self.source), patch.object(publisher, "build", self.build):
      publisher.publish(self.root, self.config, self.version, self.notes, list(targets), self.api)


class LocalContractTests(unittest.TestCase):
  def test_validate_is_offline_and_secret_free(self):
    result = subprocess.run(["bash", "scripts/release.sh", "--validate"], cwd=ROOT, capture_output=True, text=True)
    self.assertEqual(result.returncode, 0, result.stderr)
    self.assertIn("no credentials or network", result.stdout)

  def test_help_and_invalid_arguments(self):
    for args, expected in ((["--help"], 0), (["bogus"], 1), (["--validate", "android"], 1), (["android", "android"], 1)):
      with self.subTest(args=args):
        result = subprocess.run(["bash", "scripts/release.sh", *args], cwd=ROOT, capture_output=True)
        self.assertEqual(result.returncode, expected)

  def test_version_mirrors_fail_independently(self):
    with Fixture() as f:
      for name in ("package-lock.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"):
        path = f.root / name
        original = path.read_text()
        with self.subTest(name=name):
          path.write_text(original.replace(f.version, "9.9.9", 1))
          with self.assertRaises(model.Refusal):
            model.settings(f.root)
          path.write_text(original)
      path = f.root / "package-lock.json"
      original = path.read_text()
      data = json.loads(original)
      data["packages"][""]["version"] = "9.9.9"
      path.write_text(json.dumps(data))
      with self.assertRaises(model.Refusal):
        model.settings(f.root)

  def test_private_file_permissions_ownership_and_symlinks(self):
    with tempfile.TemporaryDirectory() as temporary:
      root = Path(temporary)
      secret = root / "token"
      secret.write_text("secret")
      secret.chmod(0o600)
      self.assertEqual(model.private_file(secret), secret)
      for mode in (0o644, 0o666, 0o700):
        secret.chmod(mode)
        with self.subTest(mode=mode), self.assertRaises(model.Refusal):
          model.private_file(secret)
      secret.chmod(0o600)
      link = root / "link"
      link.symlink_to(secret)
      with self.assertRaises(model.Refusal):
        model.private_file(link)
      with self.assertRaises(model.Refusal):
        model.private_file(secret, outside=root)
      info = secret.stat()
      with patch.object(os, "getuid", return_value=info.st_uid + 1), self.assertRaises(model.Refusal):
        model.private_file(secret)

  def test_manifest_missing_each_format_and_duplicate_names(self):
    with Fixture() as f:
      for target, formats in model.FORMATS.items():
        for missing in formats:
          with self.subTest(target=target, missing=missing), tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary)
            (output / target).mkdir()
            for suffix in formats:
              if suffix != missing:
                (output / target / ("ntr" + suffix)).write_bytes(b"x")
            with self.assertRaises(model.Refusal):
              model.manifest(output, [target])
      with f.build(f.root, f.config, f.version, f.commit, ["desktop", "android"]) as (entries, paths):
        self.assertEqual(len(entries), 8)
        self.assertFalse(any(n.endswith(".aab") for n in paths))
        with self.assertRaises(model.Refusal):
          model.manifest_check(entries + [entries[0]], ["desktop", "android"])

  def test_stale_checksums_unexpected_format_and_symlink_rejected(self):
    for kind in ("checksum", "aab", "symlink", "duplicate"):
      with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temporary:
        output = Path(temporary)
        directory = output / "android"
        directory.mkdir()
        (directory / "ntr.apk").write_bytes(b"apk")
        if kind == "checksum":
          (directory / "ntr.apk.sha256").write_text("stale")
        elif kind == "aab":
          (directory / "ntr.aab").write_bytes(b"aab")
        elif kind == "symlink":
          (directory / "other.apk").symlink_to(directory / "ntr.apk")
        else:
          (directory / "other.apk").write_bytes(b"duplicate format")
        with self.assertRaises(model.Refusal):
          model.manifest(output, ["android"])

  def test_payload_canonical_and_malformed_refusal(self):
    with Fixture() as f, f.build(f.root, f.config, f.version, f.commit, ["android"]) as (entries, _):
      expected = model.identity(f.root, f.config, f.version, f.commit, ["android"])
      payload = {**expected, "manifest": entries}
      self.assertEqual(model.payload_read(model.canonical(payload), expected), payload)
      invalid = [json.dumps(payload), model.canonical(payload) + "\n", '{"schema":1,"schema":1}', "NaN"]
      for field, value in (("schema", 2), ("schema", True), ("source", "b" * 40), ("targets", ["desktop"])):
        invalid.append(model.canonical({**payload, field: value}))
      for raw in invalid:
        with self.subTest(raw=raw[:50]), self.assertRaises(model.Refusal):
          model.payload_read(raw, expected)

  def test_apk_valid_wrong_key_missing_key_and_invalid_signature(self):
    path = Path("ntr.apk")
    for actual, expected, succeeds in (("a" * 64, "a" * 64, True), ("b" * 64, "a" * 64, False), ("a" * 64, None, False)):
      output = f"Signer #1 certificate SHA-256 digest: {actual}\n"
      with self.subTest(expected=expected, actual=actual), patch.object(publisher, "run", return_value=output):
        if succeeds:
          publisher.apk_check(path, expected, ROOT)
        else:
          with self.assertRaises(model.Refusal):
            publisher.apk_check(path, expected, ROOT)
    with patch.object(publisher, "run", side_effect=model.Refusal("Invalid signature")), self.assertRaises(model.Refusal):
      publisher.apk_check(path, "a" * 64, ROOT)

  def test_environment_rejects_legacy_and_insecure_overrides(self):
    for variable in ("FORGEJO_TOKEN", "FORGEJO_API_URL", "GIT_SSL_NO_VERIFY", "GIT_CONFIG_COUNT"):
      with self.subTest(variable=variable), patch.dict(os.environ, {variable: "secret"}), self.assertRaises(model.Refusal):
        publisher.environment_check()


class PublicationTests(unittest.TestCase):
  def test_publish_and_repeat_without_build_or_signing(self):
    with Fixture() as f:
      command(f.root, "git", "tag", "-a", "unrelated", "-m", "unrelated")
      command(f.root, "git", "config", "push.followTags", "true")
      f.publish()
      remote = publisher.git(f.root, "ls-remote", "origin")
      self.assertNotIn("unrelated", remote)
      before = copy.deepcopy((f.api.files, f.api.writes))
      with patch.object(publisher, "source", f.source), patch.object(publisher, "build", side_effect=AssertionError("Must not build nondeterministic artifact")), \
           patch.object(publisher, "signing_copy", side_effect=AssertionError("Must not read signing keys")):
        publisher.publish(f.root, f.config, f.version, f.notes, ["android"], f.api)
      self.assertEqual((f.api.files, f.api.writes), before)
      self.assertEqual(publisher.git(f.root, "ls-remote", "origin"), remote)
      self.assertEqual(publisher.git(f.root, "ls-remote", "origin", "refs/heads/main").split()[0], f.commit)

  def test_desktop_and_android_full_publication(self):
    with Fixture() as f:
      f.publish(("desktop", "android"))
      self.assertEqual(len(f.api.files), 8)

  def test_partial_release_stops_before_build(self):
    for state in ("tag", "release"):
      with self.subTest(state=state), Fixture() as f:
        if state == "tag":
          command(f.root, "git", "tag", "-a", "v" + f.version, "-m", "legacy")
          command(f.root, "git", "push", "origin", "refs/tags/v" + f.version)
        else:
          f.api.record = {"id": 1}
        with patch.object(publisher, "source", f.source), patch.object(publisher, "build", side_effect=AssertionError("Must not build partial release")), self.assertRaises(model.Refusal):
          publisher.publish(f.root, f.config, f.version, f.notes, ["android"], f.api)
        self.assertFalse(f.api.writes)

  def test_legacy_lightweight_tag_refused(self):
    with Fixture() as f:
      command(f.root, "git", "tag", "v" + f.version)
      command(f.root, "git", "push", "origin", "refs/tags/v" + f.version)
      with self.assertRaises(model.Refusal):
        f.publish()

  def test_dirty_unpushed_or_wrong_branch_source_refused(self):
    for state in ("dirty", "unpushed", "branch"):
      with self.subTest(state=state), Fixture() as f:
        (f.root / "extra").write_text("change")
        if state != "dirty":
          command(f.root, "git", "add", "extra")
          command(f.root, "git", "commit", "-m", "unpushed")
        if state == "branch":
          command(f.root, "git", "switch", "-c", "other")
        with self.assertRaises(model.Refusal):
          f.publish()
        self.assertFalse(f.api.writes)

  def test_changed_identity_and_corrupt_remote_evidence(self):
    for state in ("target", "notes", "settings", "bytes", "missing", "extra", "checksum", "metadata"):
      with self.subTest(state=state), Fixture() as f:
        f.publish()
        if state == "bytes":
          f.api.files["ntr.apk"] = b"X" * len(f.api.files["ntr.apk"])
        elif state == "missing":
          del f.api.files["ntr.apk"]
        elif state == "extra":
          f.api.files["unexpected.apk"] = b"x"
        elif state == "checksum":
          f.api.files["ntr.apk.sha256"] = b"x" * len(f.api.files["ntr.apk.sha256"])
        elif state == "notes":
          f.notes += "changed"
        elif state == "settings":
          path = f.root / "scripts/release.json"
          path.write_text(path.read_text() + "\n")
          command(f.root, "git", "add", ".")
          command(f.root, "git", "commit", "-m", "settings changed")
          command(f.root, "git", "push", "origin", "main")
        elif state == "metadata":
          f.api.record["draft"] = True
        before = list(f.api.writes)
        with self.assertRaises(model.Refusal):
          f.publish(("desktop",) if state == "target" else ("android",))
        self.assertEqual(f.api.writes, before)

  def test_lost_response_preserves_partial_state_and_blocks_retry(self):
    for fault in ("release-lost", "upload-lost", ".sha256"):
      with self.subTest(fault=fault), Fixture() as f:
        f.api.fault = fault
        with self.assertRaises(model.Refusal):
          f.publish()
        self.assertIsNotNone(publisher.remote_tag(f.root, "v" + f.version))
        self.assertIsNotNone(f.api.record)
        before = copy.deepcopy((f.api.files, f.api.writes))
        if fault == ".sha256":
          # The last accepted upload completes the release despite a lost response.
          f.publish()
        else:
          with self.assertRaises(model.Refusal):
            f.publish()
        self.assertEqual((f.api.files, f.api.writes), before)

  def test_tag_push_loss_has_no_rollback_or_repeat_write(self):
    with Fixture() as f:
      real_git = publisher.git

      def uncertain(root, *args):
        result = real_git(root, *args)
        if "push" in args and any("refs/tags/" in arg for arg in args):
          raise model.Refusal("Tag push response lost")
        return result

      with patch.object(publisher, "git", side_effect=uncertain), self.assertRaises(model.Refusal):
        f.publish()
      self.assertIsNotNone(publisher.remote_tag(f.root, "v" + f.version))
      self.assertFalse(f.api.writes)
      with self.assertRaises(model.Refusal):
        f.publish()

  def test_release_appearing_during_build_stops_writes(self):
    with Fixture() as f:
      original_build = f.build

      @contextlib.contextmanager
      def racing(*args):
        with original_build(*args) as output:
          f.api.record = {"id": 99}
          yield output

      f.build = racing
      with self.assertRaises(model.Refusal):
        f.publish()
      self.assertFalse(f.api.writes)
      self.assertIsNone(publisher.remote_tag(f.root, "v" + f.version))


class TransportTests(unittest.TestCase):
  def test_upload_streams_multipart_without_retry_and_refuses_bad_responses(self):
    config, _, _ = model.settings(ROOT)
    api = publisher.Forgejo(config, "not-a-real-token")

    class Response(io.BytesIO):
      status = 201

    class Connection:
      def __init__(self):
        self.parts = []
        self.headers = {}
        self.response = Response(b'{"id":1,"name":"ntr.apk"}')
        self.requests = 0

      def putrequest(self, method, url):
        self.requests += 1
        self.method = method
        self.url = url

      def putheader(self, name, value):
        self.headers[name] = value

      def endheaders(self):
        pass

      def send(self, data):
        self.parts.append(data)

      def getresponse(self):
        return self.response

      def close(self):
        pass

    with tempfile.TemporaryDirectory() as temporary:
      path = Path(temporary) / "ntr.apk"
      path.write_bytes(b"signed apk bytes")
      connection = Connection()
      with patch.object(publisher.http.client, "HTTPSConnection", return_value=connection):
        api.upload(1, path)
      self.assertEqual(connection.method, "POST")
      self.assertEqual(connection.requests, 1)
      self.assertIn(b"signed apk bytes", b"".join(connection.parts))
      self.assertEqual(int(connection.headers["Content-Length"]), len(b"".join(connection.parts)))
      self.assertNotIn("not-a-real-token", connection.url)
      for status, body in ((302, b""), (500, b""), (201, b"not json"), (201, b'{"id":0}')):
        connection = Connection()
        connection.response = Response(body)
        connection.response.status = status
        with self.subTest(status=status, body=body), patch.object(publisher.http.client, "HTTPSConnection", return_value=connection), self.assertRaises(model.Refusal):
          api.upload(1, path)
        self.assertEqual(connection.requests, 1)

  def test_api_identity_and_permissions_are_checked_before_writes(self):
    config, _, _ = model.settings(ROOT)
    api = publisher.Forgejo(config, "not-a-real-token")
    good = [{"version": "11.0.0"}, {"login": config["username"]},
            {"full_name": config["repository"], "permissions": {"push": True}}]
    with patch.object(api, "json", side_effect=good):
      api.preflight(config)
    for index, value in ((0, {"version": "unknown"}), (1, {"login": "wrong"}),
                         (2, {"full_name": config["repository"], "permissions": {"push": False}})):
      responses = copy.deepcopy(good)
      responses[index] = value
      with self.subTest(index=index), patch.object(api, "json", side_effect=responses), self.assertRaises(model.Refusal):
        api.preflight(config)

  def test_download_counters_do_not_invalidate_a_complete_release(self):
    with Fixture() as f:
      f.publish()
      actual_release = f.api.release
      counter = 0

      def release(tag):
        nonlocal counter
        counter += 1
        return {**actual_release(tag), "assets": [{"download_count": counter}]}

      with patch.object(f.api, "release", side_effect=release):
        f.publish()

  def test_secret_tool_output_is_not_exposed_on_failure(self):
    sentinel = "PRIVATE_TOKEN_DO_NOT_PRINT"
    with self.assertRaises(model.Refusal) as error:
      publisher.run([sys.executable, "-c", f"import sys; print('{sentinel}'); sys.exit(1)"], ROOT)
    self.assertNotIn(sentinel, str(error.exception))

  def test_cross_origin_or_write_redirect_does_not_forward_credentials(self):
    handler = publisher.SameOriginRedirect()
    request = urllib.request.Request("https://git.lan/attachments/abc", headers={"Authorization": "token secret"})
    for url in ("https://evil.invalid/secret", "http://git.lan/secret", "https://user:pass@git.lan/secret"):
      with self.subTest(url=url), self.assertRaises(model.Refusal):
        handler.redirect_request(request, None, 302, "redirect", {}, url)
    post = urllib.request.Request("https://git.lan/api/v1", data=b"{}")
    with self.assertRaises(model.Refusal):
      handler.redirect_request(post, None, 302, "redirect", {}, "https://git.lan/other")

  def test_pagination_and_malformed_assets(self):
    config, _, _ = model.settings(ROOT)
    api = publisher.Forgejo(config, "not-a-real-token")
    with patch.object(api, "json", side_effect=[[{}] * 50, [{}] * 2]) as call:
      self.assertEqual(len(api.assets(1)), 52)
      self.assertEqual(call.call_count, 2)
    with patch.object(api, "json", return_value={}), self.assertRaises(model.Refusal):
      api.assets(1)

  def test_download_limits_and_content_hash(self):
    config, _, _ = model.settings(ROOT)
    api = publisher.Forgejo(config, "not-a-real-token")
    class Response(io.BytesIO):
      status = 200
    with patch.object(api, "open", return_value=Response(b"abc")):
      self.assertEqual(api.asset_digest("https://git.lan/attachments/a", 3), model.digest(b"abc"))
    for value in (b"ab", b"abcd"):
      with self.subTest(value=value), patch.object(api, "open", return_value=Response(value)), self.assertRaises(model.Refusal):
        api.asset_digest("https://git.lan/attachments/a", 3)

  def test_untrusted_download_url_and_oversized_metadata(self):
    config, _, _ = model.settings(ROOT)
    api = publisher.Forgejo(config, "not-a-real-token")
    with self.assertRaises(model.Refusal):
      api.open("https://evil.invalid/attachments/a")
    class Response(io.BytesIO):
      status = 200
    with patch.object(api, "open", return_value=Response(b"x" * (2 * 1024**2 + 1))), self.assertRaises(model.Refusal):
      api.json(api.base)


class SigningTests(unittest.TestCase):
  def prepare(self, root):
    target = root / "android-signing"
    target.mkdir(mode=0o700)
    for name in ("release.keystore", "keystore.properties"):
      (target / name).write_text("secret")
      (target / name).chmod(0o600)
    return target

  def test_ignored_secret_copy_and_cleanup_preserve_originals(self):
    with Fixture() as f:
      target = self.prepare(f.root)
      self.assertEqual(publisher.git(f.root, "status", "--porcelain"), "")
      self.assertEqual(publisher.git(f.root, "ls-files", "android-signing"), "")
      with tempfile.TemporaryDirectory() as temporary:
        checkout = Path(temporary)
        publisher.signing_copy(f.root, checkout)
        self.assertEqual((checkout / "android-signing/release.keystore").read_text(), "secret")
      self.assertEqual((target / "release.keystore").read_text(), "secret")

  def test_missing_or_insecure_signing_material_refused(self):
    with Fixture() as f, tempfile.TemporaryDirectory() as temporary:
      with self.assertRaises(OSError):
        publisher.signing_copy(f.root, Path(temporary))
      target = self.prepare(f.root)
      target.chmod(0o755)
      with self.assertRaises(model.Refusal):
        publisher.signing_copy(f.root, Path(temporary))

  def test_properties_roundtrip_and_migration_no_overwrite(self):
    with Fixture() as f:
      legacy = f.root / "src-tauri/gen/android"
      legacy.mkdir(parents=True)
      key = legacy / "release.keystore"
      key.write_bytes(b"original private key")
      key.chmod(0o600)
      props = legacy / "keystore.properties"
      props.write_text("storeFile=release.keystore\nkeyAlias=ntr\npassword=test-password\n")
      props.chmod(0o600)
      with patch.object(signing, "fingerprint", return_value="a" * 64):
        signing.migrate(f.root)
        self.assertEqual((f.root / "android-signing/release.keystore").read_bytes(), key.read_bytes())
        self.assertEqual(signing.properties(f.root / "android-signing/keystore.properties")["storePassword"], "test-password")
        with self.assertRaises(model.Refusal):
          signing.migrate(f.root)
      self.assertTrue(key.exists())
      self.assertTrue(props.exists())

  def test_properties_escape_special_characters_without_shell_or_java_interpretation(self):
    with tempfile.TemporaryDirectory() as temporary:
      path = Path(temporary) / "keystore.properties"
      password = " leading:#=\\! trailing "
      signing.write_properties(path, {"keyAlias": "ntr", "password": password})
      result = signing.properties(path)
      self.assertEqual(result["storePassword"], password)
      self.assertEqual(result["keyPassword"], password)
      self.assertEqual(path.stat().st_mode & 0o777, 0o600)

  def test_tracked_source_mutation_is_refused(self):
    with Fixture() as f:
      publisher.unchanged(f.root, f.commit)
      (f.root / "package.json").write_text("changed")
      with self.assertRaises(model.Refusal):
        publisher.unchanged(f.root, f.commit)


class BuildAndSourceTests(unittest.TestCase):
  def tools(self, f):
    tools = f.base / "tools"
    tools.mkdir()
    script = '''#!/usr/bin/env python3
import json, os
from pathlib import Path
import sys
tool = Path(sys.argv[0]).name
args = sys.argv[1:]
with open(os.environ["NTR_TEST_LOG"], "a") as log:
  log.write(tool + ":" + " ".join(args) + "\\n")
if tool == "node":
  print(json.loads(Path("package.json").read_text())["version"])
elif tool == "apksigner":
  print("Signer #1 certificate SHA-256 digest: " + "a" * 64)
elif tool == "npm" and args == ["ci"] and os.environ.get("NTR_TEST_MUTATE"):
  Path("package.json").write_text("changed tracked source")
elif tool == "npm" and "tauri" in args:
  if "android" in args:
    assert "--apk" in args and "--aab" not in args
    output = Path("src-tauri/gen/android/app/build/outputs/apk/universal/release/ntr.apk")
    output.parent.mkdir(parents=True)
    output.write_bytes(b"fresh signed test apk")
  else:
    for folder, suffix in (("appimage", ".AppImage"), ("deb", ".deb"), ("rpm", ".rpm")):
      if os.environ.get("NTR_TEST_MISSING") == suffix:
        continue
      output = Path("src-tauri/target/release/bundle") / folder / ("ntr" + suffix)
      output.parent.mkdir(parents=True, exist_ok=True)
      output.write_bytes(b"fresh desktop test package")
'''
    for tool in ("npm", "node", "cargo", "apksigner"):
      path = tools / tool
      path.write_text(script)
      path.chmod(0o700)
    return {"PATH": str(tools) + os.pathsep + os.environ["PATH"], "NTR_TEST_LOG": str(f.base / "tools.log")}

  def test_isolated_real_build_entrypoint_ignores_old_artifacts_and_is_apk_only(self):
    with Fixture() as f:
      SigningTests().prepare(f.root)
      stale = f.root / "release" / f.version / "android"
      stale.mkdir(parents=True)
      (stale / "stale.apk").write_bytes(b"stale ignored artifact")
      with patch.dict(os.environ, self.tools(f)):
        with publisher.build(f.root, f.config, f.version, f.commit, ["desktop", "android"]) as (entries, paths):
          self.assertEqual(len(entries), 8)
          self.assertEqual(paths["ntr.apk"].read_bytes(), b"fresh signed test apk")
          isolated = paths["ntr.apk"].parents[3]
        self.assertFalse(isolated.exists())
      log = (f.base / "tools.log").read_text()
      self.assertIn("--apk --ci", log)
      self.assertNotIn("--aab", log)
      self.assertIn("npm:ci", log)
      self.assertIn("npm:test", log)
      self.assertEqual((stale / "stale.apk").read_bytes(), b"stale ignored artifact")
      self.assertEqual((f.root / "android-signing/release.keystore").read_text(), "secret")

  def test_isolated_setup_cannot_mutate_tracked_source(self):
    with Fixture() as f:
      env = self.tools(f)
      env["NTR_TEST_MUTATE"] = "1"
      with patch.dict(os.environ, env), self.assertRaises(model.Refusal):
        with publisher.build(f.root, f.config, f.version, f.commit, ["desktop"]):
          self.fail("Mutation must stop the build")

  def test_build_missing_required_desktop_format_refused(self):
    with Fixture() as f:
      env = self.tools(f)
      env["NTR_TEST_MISSING"] = ".rpm"
      with patch.dict(os.environ, env), self.assertRaises(model.Refusal):
        with publisher.build(f.root, f.config, f.version, f.commit, ["desktop"]):
          self.fail("Missing rpm must stop publication")

  def test_source_transport_identity_and_exact_pushed_main(self):
    with Fixture() as f:
      original_git = publisher.git
      destination = "https://git.lan/ntr/ntr-app.git"

      def observed(root, *args):
        if args[:2] == ("remote", "get-url"):
          return destination
        return original_git(root, *args)

      with patch.object(publisher, "git", side_effect=observed):
        self.assertEqual(publisher.source(f.root, f.config), f.commit)
        destination = "https://evil.invalid/ntr/ntr-app.git"
        with self.assertRaises(model.Refusal):
          publisher.source(f.root, f.config)
        destination = "https://git.lan/ntr/ntr-app.git\nhttps://git.lan/other.git"
        with self.assertRaises(model.Refusal):
          publisher.source(f.root, f.config)

  def test_lock_blocks_a_second_publisher_before_network_or_build(self):
    with Fixture() as f:
      token = f.base / "token"
      token.write_text("a" * 40)
      token.chmod(0o600)
      with (f.root / ".git/app-release.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with patch.object(publisher, "__file__", str(f.root / "scripts/release_publish.py")), \
             patch.object(sys, "argv", ["release_publish.py", "desktop"]), \
             patch.dict(os.environ, {"GIT_TOKEN": str(token)}), \
             patch.object(publisher, "publish", side_effect=AssertionError("Must not publish")), self.assertRaises(model.Refusal):
          publisher.main()


if __name__ == "__main__":
  unittest.main()
