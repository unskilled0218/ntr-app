"""Local release contracts. This module performs no network requests."""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tomllib


class Refusal(Exception):
  """An unsafe or ambiguous release must stop without repair."""


def require(condition, message):
  if not condition:
    raise Refusal(message)


def canonical(value):
  return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def unique_object(pairs):
  result = {}
  for key, value in pairs:
    require(key not in result, "Duplicate JSON key")
    result[key] = value
  return result


def decode(raw):
  try:
    return json.loads(raw, object_pairs_hook=unique_object,
                      parse_constant=lambda _: require(False, "Invalid JSON number"))
  except (ValueError, UnicodeError) as error:
    raise Refusal("Invalid JSON") from error


def digest(data):
  return hashlib.sha256(data).hexdigest()


def file_digest(path):
  value = hashlib.sha256()
  with path.open("rb") as stream:
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
      value.update(chunk)
  return value.hexdigest()


def private_file(path, outside=None):
  path = Path(path).expanduser().absolute()
  info = path.lstat()
  require(stat.S_ISREG(info.st_mode) and not path.is_symlink(), "Secret must be a regular non-symlink file")
  require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) in (0o400, 0o600),
          "Secret must be user-owned with mode 0400 or 0600")
  require(path.resolve() == path, "Secret path must not contain symlinks")
  if outside:
    require(not path.is_relative_to(outside.resolve()), "API token must be outside the repository")
  return path


def settings(root):
  config = decode((root / "scripts/release.json").read_bytes())
  keys = {"schema", "gitea", "repository", "username", "token_file", "notes", "targets", "android_certificate_sha256"}
  require(isinstance(config, dict) and set(config) == keys and type(config["schema"]) is int and config["schema"] == 1,
          "Unsupported release configuration")
  require(isinstance(config["gitea"], str) and re.fullmatch(r"https://[a-zA-Z0-9.-]+(?::[0-9]+)?", config["gitea"]),
          "Forgejo origin must be a credential-free HTTPS origin")
  require(isinstance(config["repository"], str) and re.fullmatch(r"[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+", config["repository"]),
          "Invalid repository")
  require(isinstance(config["username"], str) and re.fullmatch(r"[A-Za-z0-9_.-]+", config["username"]), "Invalid username")
  require(isinstance(config["token_file"], str) and config["token_file"] and "\n" not in config["token_file"], "Invalid token file path")
  targets = config["targets"]
  require(isinstance(targets, list) and targets and all(t in ("desktop", "android") for t in targets)
          and len(set(targets)) == len(targets), "Invalid configured targets")
  certificate = config["android_certificate_sha256"]
  require(certificate is None or (isinstance(certificate, str) and re.fullmatch(r"[0-9a-f]{64}", certificate)), "Invalid certificate fingerprint")
  version = decode((root / "package.json").read_bytes())["version"]
  require(isinstance(version, str) and re.fullmatch(r"(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", version), "Invalid version")
  lock = decode((root / "package-lock.json").read_bytes())
  cargo = tomllib.loads((root / "src-tauri/Cargo.toml").read_text())
  cargo_lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
  mirrors = [lock["version"], lock["packages"][""]["version"],
             decode((root / "src-tauri/tauri.conf.json").read_bytes())["version"], cargo["package"]["version"]]
  entries = [p["version"] for p in cargo_lock["package"] if p["name"] == cargo["package"]["name"]]
  require(len(entries) == 1 and all(v == version for v in mirrors + entries), "Version mirrors disagree")
  require(config["notes"] == f"docs/releases/{version}.md", "Release notes must match version")
  notes = (root / config["notes"]).read_text()
  require(notes.startswith(f"# Release v{version}\n"), "Invalid release notes heading")
  return config, version, notes


def identity(root, config, version, source, targets):
  files = ["scripts/release.json", config["notes"]]
  files += [str(p.relative_to(root)) for p in sorted((root / "scripts").glob("release*")) if p.is_file()]
  files += ["scripts/build-release.sh", "scripts/android-keystore.sh", "scripts/android_signing.py"]
  return {"schema": 1, "version": version, "source": source, "targets": sorted(targets),
          "files": {name: digest((root / name).read_bytes()) for name in sorted(set(files))}}


FORMATS = {"desktop": (".AppImage", ".deb", ".rpm"), "android": (".apk",)}
SAFE_NAME = r"[A-Za-z0-9][A-Za-z0-9._+-]{0,199}"


def manifest_check(entries, targets):
  require(isinstance(entries, list) and 0 < len(entries) <= 8, "Invalid manifest size")
  names = []
  for entry in entries:
    require(isinstance(entry, dict) and set(entry) == {"name", "size", "sha256"}, "Invalid manifest entry")
    require(isinstance(entry["name"], str) and re.fullmatch(SAFE_NAME, entry["name"]), "Invalid asset name")
    require(type(entry["size"]) is int and 0 < entry["size"] <= 2 * 1024**3, "Invalid asset size")
    require(isinstance(entry["sha256"], str) and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]), "Invalid asset digest")
    names.append(entry["name"])
  require(names == sorted(set(names)), "Manifest names must be sorted and unique")
  packages = [n for n in names if not n.endswith(".sha256")]
  expected = [suffix for target in targets for suffix in FORMATS[target]]
  require(len(packages) == len(expected) and len(names) == 2 * len(packages), "Incomplete artifact inventory")
  for suffix in expected:
    require(sum(n.endswith(suffix) for n in packages) == 1, "Missing or duplicate required format")
  require(all(n + ".sha256" in names for n in packages), "Missing checksum file")
  by_name = {entry["name"]: entry for entry in entries}
  for name in packages:
    checksum_bytes = f"{by_name[name]['sha256']}  {name}\n".encode()
    checksum = by_name[name + ".sha256"]
    require(checksum["size"] == len(checksum_bytes) and checksum["sha256"] == digest(checksum_bytes),
            "Checksum entry does not describe its artifact")


def manifest(directory, targets):
  paths = {}
  for target in targets:
    location = directory / target
    require(location.is_dir() and not location.is_symlink(), "Missing target directory")
    for path in location.iterdir():
      require(path.is_file() and not path.is_symlink() and path.name not in paths, "Ambiguous artifact")
      require(re.fullmatch(SAFE_NAME, path.name), "Unsafe artifact name")
      require(not path.name.endswith(".sha256"), "Preexisting checksum file")
      require(path.suffix in FORMATS[target], "Unexpected artifact format")
      paths[path.name] = path
  for name, path in list(paths.items()):
    checksum = path.with_name(name + ".sha256")
    checksum.write_text(f"{file_digest(path)}  {name}\n")
    paths[checksum.name] = checksum
  entries = [{"name": n, "size": p.stat().st_size, "sha256": file_digest(p)} for n, p in sorted(paths.items())]
  manifest_check(entries, targets)
  return entries, paths


def payload_read(raw, expected):
  require(len(raw) <= 65536, "Tag payload too large")
  payload = decode(raw)
  require(isinstance(payload, dict) and set(payload) == set(expected) | {"manifest"}, "Invalid tag identity")
  require(canonical(payload) == raw, "Noncanonical tag identity")
  require(canonical({k: v for k, v in payload.items() if k != "manifest"}) == canonical(expected), "Release identity changed")
  manifest_check(payload["manifest"], expected["targets"])
  return payload
