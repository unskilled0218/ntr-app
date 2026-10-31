#!/usr/bin/env bash
# Standalone builds require fresh output directories; the publisher uses an isolated checkout.
set -Eeuo pipefail
set +x
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"
version=$(node -p "require('./package.json').version")
targets=("$@")
if [[ ${#targets[@]} == 0 ]]; then targets=(desktop android); fi
declare -A selected=()
for target in "${targets[@]}"; do
  [[ "$target" == desktop || "$target" == android ]] || { echo 'Expected desktop or android' >&2; exit 2; }
  [[ ! ${selected[$target]+yes} ]] || { echo 'Duplicate build target' >&2; exit 2; }
  selected[$target]=1
  [[ ! -e "release/$version/$target" ]] || { echo 'Output already exists; preserve it and use a fresh checkout' >&2; exit 1; }
done
collect_one() {
  local directory=$1 pattern=$2 destination=$3
  local files=()
  shopt -s nullglob
  files=("$directory"/$pattern)
  shopt -u nullglob
  [[ ${#files[@]} == 1 && -f ${files[0]} && ! -L ${files[0]} ]] || { echo "Missing or ambiguous required format: $pattern" >&2; exit 1; }
  cp -- "${files[0]}" "$destination/"
}
if [[ ${selected[desktop]+yes} ]]; then
  echo 'Release: Starting desktop build' >&2
  [[ ! -e src-tauri/target/release/bundle ]] || { echo 'Desktop bundles already exist; use a fresh checkout' >&2; exit 1; }
  npm run tauri build
  mkdir -p "release/$version/desktop"
  for pair in 'appimage *.AppImage' 'deb *.deb' 'rpm *.rpm'; do
    read -r directory pattern <<< "$pair"
    collect_one "src-tauri/target/release/bundle/$directory" "$pattern" "release/$version/desktop"
  done
  echo 'Release: Completed desktop build' >&2
fi
if [[ ${selected[android]+yes} ]]; then
  echo 'Release: Starting Android build' >&2
  [[ ! -e src-tauri/gen/android/app/build/outputs ]] || { echo 'Android outputs already exist; use a fresh checkout' >&2; exit 1; }
  [[ -f android-signing/release.keystore && -f android-signing/keystore.properties ]] || { echo 'Prepare android-signing files first' >&2; exit 1; }
  # Tauri prepares only ignored support files for the already tracked Android project.
  npm run tauri -- android build --apk --ci
  mkdir -p "release/$version/android"
  collect_one src-tauri/gen/android/app/build/outputs/apk/universal/release '*.apk' "release/$version/android"
  [[ ! -e src-tauri/gen/android/app/build/outputs/bundle ]] || { echo 'Unexpected AAB output' >&2; exit 1; }
  echo 'Release: Completed Android build' >&2
fi
echo "Build artifacts: release/$version"
