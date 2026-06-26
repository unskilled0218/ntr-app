#!/usr/bin/env bash
#
# Create a release signing keystore and the matching keystore.properties so that
# `tauri android build` produces a SIGNED apk/aab that installs on a real device.
#
# Without this, the release build emits app-universal-release-unsigned.apk, which
# Android refuses to install (INSTALL_PARSE_FAILED_NO_CERTIFICATES / "App not installed").
#
# Usage:
#   scripts/android-keystore.sh            # create keystore (prompts for a password)
#   KEYSTORE_PASSWORD=secret scripts/android-keystore.sh   # non-interactive
#
# The keystore and keystore.properties live under src-tauri/gen/android and are
# gitignored. Keep the keystore file safe: it is required to ship updates.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ANDROID_DIR="$REPO_ROOT/src-tauri/gen/android"
KEYSTORE_FILE="$ANDROID_DIR/release.keystore"
PROPS_FILE="$ANDROID_DIR/keystore.properties"
KEY_ALIAS="ntr"

if [ -e "$KEYSTORE_FILE" ]; then
  echo "error: $KEYSTORE_FILE already exists; refusing to overwrite" >&2
  exit 1
fi

PASSWORD="${KEYSTORE_PASSWORD:-}"
if [ -z "$PASSWORD" ]; then
  read -r -s -p "Keystore password: " PASSWORD; echo
  read -r -s -p "Confirm password: " PASSWORD2; echo
  if [ "$PASSWORD" != "$PASSWORD2" ]; then
    echo "error: passwords do not match" >&2
    exit 1
  fi
fi
if [ ${#PASSWORD} -lt 6 ]; then
  echo "error: keystore password must be at least 6 characters" >&2
  exit 1
fi

keytool -genkeypair -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASSWORD" -keypass "$PASSWORD" \
  -dname "CN=ntr, OU=ntr, O=ntr, L=, ST=, C="

# storeFile is resolved relative to the android root (where build.gradle.kts uses rootProject.file).
cat > "$PROPS_FILE" <<EOF
storeFile=release.keystore
keyAlias=$KEY_ALIAS
password=$PASSWORD
EOF

echo "==> wrote $KEYSTORE_FILE"
echo "==> wrote $PROPS_FILE (gitignored)"
echo "Release builds will now be signed. Back up release.keystore; losing it blocks future updates."
