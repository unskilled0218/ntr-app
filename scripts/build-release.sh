#!/usr/bin/env bash
#
# Build release artifacts (desktop + Android) and collect them under
#   <repo>/release/<version>/{desktop,android}/
#
# Usage:
#   scripts/build-release.sh              # build both desktop and android
#   scripts/build-release.sh desktop      # build desktop only
#   scripts/build-release.sh android      # build android only
#   scripts/build-release.sh desktop android
#
# Version is read from src-tauri/tauri.conf.json.

set -euo pipefail

# --- locate repo root (this script lives in <repo>/scripts) ---------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- read version ---------------------------------------------------------
VERSION="$(node -p "require('./src-tauri/tauri.conf.json').version")"
if [ -z "$VERSION" ]; then
  echo "error: could not read version from src-tauri/tauri.conf.json" >&2
  exit 1
fi

OUT_DIR="$REPO_ROOT/release/$VERSION"

# --- decide what to build -------------------------------------------------
BUILD_DESKTOP=0
BUILD_ANDROID=0
if [ "$#" -eq 0 ]; then
  BUILD_DESKTOP=1
  BUILD_ANDROID=1
else
  for target in "$@"; do
    case "$target" in
      desktop) BUILD_DESKTOP=1 ;;
      android) BUILD_ANDROID=1 ;;
      *) echo "error: unknown target '$target' (expected: desktop, android)" >&2; exit 1 ;;
    esac
  done
fi

echo "==> ntr release build  (version $VERSION)"
echo "    output: $OUT_DIR"

# collect <pattern...> <dest>: copy matching files (if any) into dest
collect() {
  local dest="${@: -1}"
  local patterns=("${@:1:$#-1}")
  mkdir -p "$dest"
  local found=0
  for pat in "${patterns[@]}"; do
    for f in $pat; do
      if [ -e "$f" ]; then
        mv -v "$f" "$dest/"
        found=1
      fi
    done
  done
  if [ "$found" -eq 0 ]; then
    echo "    (warning: no artifacts matched for $dest)" >&2
  fi
}

# --- desktop --------------------------------------------------------------
if [ "$BUILD_DESKTOP" -eq 1 ]; then
  echo "==> building desktop bundles"
  npm run tauri build

  BUNDLE="$REPO_ROOT/src-tauri/target/release/bundle"
  collect \
    "$BUNDLE/appimage/"*.AppImage \
    "$BUNDLE/deb/"*.deb \
    "$BUNDLE/rpm/"*.rpm \
    "$OUT_DIR/desktop"
fi

# --- android --------------------------------------------------------------
if [ "$BUILD_ANDROID" -eq 1 ]; then
  echo "==> building android (apk + aab)"
  npm run tauri android build

  ANDROID_OUT="$REPO_ROOT/src-tauri/gen/android/app/build/outputs"
  collect \
    "$ANDROID_OUT/apk/universal/release/"*.apk \
    "$ANDROID_OUT/bundle/universalRelease/"*.aab \
    "$OUT_DIR/android"
fi

echo "==> done. artifacts in $OUT_DIR"
ls -lR "$OUT_DIR"
