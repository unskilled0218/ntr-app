"""Explicit local key creation/migration; never called by the publisher."""

import argparse
import base64
import getpass
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

from release_model import Refusal, digest, private_file, require
from release_publish import git, run


def properties(path):
  """Read the narrow signing-properties contract without evaluating any code."""
  values = {}
  for line in path.read_text().splitlines():
    if not line.strip() or line.lstrip().startswith(("#", "!")):
      continue
    require("=" in line, "Signing properties must use key=value lines")
    key, value = line.split("=", 1)
    require(key in {"storeFile", "keyAlias", "password", "storePassword", "keyPassword"}
            and key not in values, "Unsupported/duplicate signing property")
    # Files created here encode all sensitive characters using Java Unicode escapes.
    require(not re.search(r"\\(?!u[0-9a-fA-F]{4})", value), "Unsupported signing property escape")
    value = re.sub(r"\\u([0-9a-fA-F]{4})", lambda match: chr(int(match[1], 16)), value)
    require("\x00" not in value and "\n" not in value and "\r" not in value,
            "Unsupported signing property escape")
    values[key] = value
  require(values.get("keyAlias") and (values.get("storePassword") or values.get("password")), "Incomplete signing properties")
  return values


def escaped(value):
  require(all(32 <= ord(c) <= 126 for c in value), "Use printable ASCII signing values")
  return "".join(f"\\u{ord(c):04x}" for c in value)


def write_properties(path, values):
  selected = {"storeFile": "release.keystore", "keyAlias": values["keyAlias"],
              "storePassword": values.get("storePassword", values.get("password", "")),
              "keyPassword": values.get("keyPassword", values.get("password", values.get("storePassword", "")))}
  with path.open("x") as stream:
    stream.write("".join(f"{key}={escaped(value)}\n" for key, value in selected.items()))
  path.chmod(0o600)


def fingerprint(key, values, root):
  with tempfile.TemporaryDirectory(prefix="ntr-key-password-") as temporary:
    password_file = Path(temporary) / "password"
    password_file.write_text(values.get("storePassword", values.get("password", "")))
    password_file.chmod(0o600)
    output = run(["keytool", "-exportcert", "-rfc", "-keystore", str(key), "-alias", values["keyAlias"],
                  "-storepass:file", str(password_file)], root)
    match = re.search(r"-----BEGIN CERTIFICATE-----\s+([A-Za-z0-9+/=\s]+)-----END CERTIFICATE-----", output)
    require(match is not None, "Cannot read signing certificate")
    return digest(base64.b64decode(re.sub(r"\s", "", match[1]), validate=True))


def destination(root):
  target = root / "android-signing"
  require(not git(root, "ls-files", "android-signing"), "Signing directory contains tracked files")
  require(git(root, "check-ignore", "--", "android-signing/probe") == "android-signing/probe", "Add signing ignore rule first")
  require(not target.is_symlink(), "Signing directory must not be a symlink")
  target.mkdir(mode=0o700, exist_ok=True)
  require(target.stat().st_uid == os.getuid() and target.stat().st_mode & 0o777 == 0o700, "Signing directory must be user-owned mode 0700")
  require(not any(target.iterdir()), "Signing destination is not empty; refusing overwrite")
  return target


def migrate(root):
  legacy = root / "src-tauri/gen/android"
  key = private_file(legacy / "release.keystore")
  props = private_file(legacy / "keystore.properties")
  values = properties(props)
  require(values.get("storeFile") == "release.keystore", "Legacy storeFile must name release.keystore; inspect manual migration")
  before = fingerprint(key, values, root)
  target = destination(root)
  shutil.copyfile(key, target / "release.keystore")
  (target / "release.keystore").chmod(0o600)
  write_properties(target / "keystore.properties", values)
  require(fingerprint(target / "release.keystore", properties(target / "keystore.properties"), root) == before,
          "Migrated certificate differs; originals preserved")
  require((target / "release.keystore").read_bytes() == key.read_bytes(), "Migrated key bytes differ")
  print(f"Copied existing key; originals preserved. Certificate SHA-256: {before}")


def create(root):
  legacy = root / "src-tauri/gen/android"
  require(not (legacy / "release.keystore").exists() and not (legacy / "keystore.properties").exists(),
          "Legacy signing files exist; migrate instead of replacing the key")
  target = destination(root)
  password = getpass.getpass("Keystore password: ")
  require(password == getpass.getpass("Confirm password: ") and len(password) >= 6, "Passwords must match and contain at least six characters")
  escaped(password)
  with tempfile.TemporaryDirectory(prefix="ntr-create-key-") as temporary:
    password_file = Path(temporary) / "password"
    password_file.write_text(password)
    password_file.chmod(0o600)
    run(["keytool", "-genkeypair", "-keystore", str(target / "release.keystore"), "-alias", "ntr",
         "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000", "-storepass:file", str(password_file),
         "-keypass:file", str(password_file), "-dname", "CN=ntr, OU=ntr, O=ntr, C=US"], root)
  (target / "release.keystore").chmod(0o600)
  write_properties(target / "keystore.properties", {"keyAlias": "ntr", "password": password})
  print("Created local signing files. Back up the keystore and passwords securely.")
  print("Certificate SHA-256: " + fingerprint(target / "release.keystore", properties(target / "keystore.properties"), root))


def main():
  parser = argparse.ArgumentParser(description="Manage local gitignored Android signing files; no publication")
  modes = parser.add_mutually_exclusive_group(required=True)
  modes.add_argument("--create", action="store_true", help="Explicitly create a first signing key; never replace an existing key")
  modes.add_argument("--migrate", action="store_true", help="Copy and verify existing legacy key; preserve originals")
  modes.add_argument("--fingerprint", action="store_true", help="Print public certificate fingerprint only")
  args = parser.parse_args()
  root = Path(__file__).resolve().parent.parent
  os.umask(0o077)
  if args.create:
    create(root)
  elif args.migrate:
    migrate(root)
  else:
    key = private_file(root / "android-signing/release.keystore")
    props = private_file(root / "android-signing/keystore.properties")
    print(fingerprint(key, properties(props), root))


if __name__ == "__main__":
  try:
    main()
  except (Refusal, OSError, ValueError, KeyError) as error:
    print(str(error) if isinstance(error, Refusal) else "Signing operation failed; private details withheld", file=sys.stderr)
    sys.exit(1)
