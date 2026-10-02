#!/usr/bin/env bash

set -euo pipefail

usage() {
  echo "Usage: $0 [desktop|android]..." >&2
  exit 2
}

release_targets=()
if [ "$#" -eq 0 ]; then
  release_targets=(desktop android)
else
  for target in "$@"; do
    case "$target" in
      desktop|android) release_targets+=("$target") ;;
      *) usage ;;
    esac
  done
fi

: "${FORGEJO_TOKEN:?set FORGEJO_TOKEN to a token with repository write access}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
api_url="${FORGEJO_API_URL:-https://git.lan/api/v1/repos/ntr/ntr-app}"

for command in curl git node npm sha256sum; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Required command is not installed: $command" >&2
    exit 1
  fi
done

if [ -n "$(git -C "$project_root" status --porcelain --untracked-files=all)" ]; then
  echo "The working tree has uncommitted changes; refusing to release" >&2
  exit 1
fi

current_branch="$(git -C "$project_root" branch --show-current)"
if [ "$current_branch" != "main" ]; then
  echo "Releases must run from main; current branch is ${current_branch:-detached HEAD}" >&2
  exit 1
fi

version="$(node -p "require('$project_root/src-tauri/tauri.conf.json').version")"
package_version="$(node -p "require('$project_root/package.json').version")"
if [ -z "$version" ] || [ "$version" != "$package_version" ]; then
  echo "App versions are missing or inconsistent: Tauri=$version npm=$package_version" >&2
  exit 1
fi

release_tag="v$version"
release_dir="$project_root/release/$version"
head_commit="$(git -C "$project_root" rev-parse HEAD)"

echo "Releasing $release_tag from $head_commit"
git -C "$project_root" push origin main
git -C "$project_root" fetch --tags origin

tag_commit="$(git -C "$project_root" rev-parse -q --verify "refs/tags/$release_tag^{commit}" 2>/dev/null || true)"
if [ -n "$tag_commit" ] && [ "$tag_commit" != "$head_commit" ]; then
  echo "Release tag $release_tag already identifies a different commit" >&2
  exit 1
fi

(
  cd "$project_root"
  npm test
  "$script_dir/build-release.sh" "$@"
)

assets=()
asset_names=()
shopt -s nullglob
for target in "${release_targets[@]}"; do
  for asset in "$release_dir/$target"/*; do
    if [ ! -f "$asset" ] || [[ "$asset" == *.sha256 ]]; then
      continue
    fi
    checksum="$asset.sha256"
    (
      cd "$(dirname "$asset")"
      sha256sum "$(basename "$asset")" > "$(basename "$checksum")"
      sha256sum -c "$(basename "$checksum")"
    )
    assets+=("$asset" "$checksum")
    asset_names+=("$(basename "$asset")" "$(basename "$checksum")")
  done
done
shopt -u nullglob

if [ "${#assets[@]}" -eq 0 ]; then
  echo "No release artifacts found under $release_dir" >&2
  exit 1
fi

if [ -z "$tag_commit" ]; then
  git -C "$project_root" tag "$release_tag" "$head_commit"
fi
git -C "$project_root" push origin "refs/tags/$release_tag"

auth_config="$(mktemp)"
response="$(mktemp)"
release_payload=""
uploaded_asset_ids=()

cleanup() {
  local exit_status=$?
  local asset_id
  trap - EXIT
  if [ "$exit_status" -ne 0 ] && [ -n "${release_id:-}" ]; then
    for asset_id in "${uploaded_asset_ids[@]}"; do
      if ! curl --silent --show-error --fail \
        --config "$auth_config" \
        --output /dev/null \
        --request DELETE \
        "$api_url/releases/$release_id/assets/$asset_id"; then
        echo "Could not remove partial Forgejo asset $asset_id; delete it manually" >&2
      fi
    done
  fi
  rm -f "$auth_config" "$response"
  if [ -n "$release_payload" ]; then
    rm -f "$release_payload"
  fi
  exit "$exit_status"
}

trap cleanup EXIT
chmod 600 "$auth_config"
printf 'header = "Authorization: token %s"\n' "$FORGEJO_TOKEN" > "$auth_config"

status="$(curl --silent --show-error \
  --config "$auth_config" \
  --output "$response" \
  --write-out '%{http_code}' \
  "$api_url/releases/tags/$release_tag")"

if [ "$status" = "404" ]; then
  release_payload="$(mktemp)"
  node - "$release_tag" "$head_commit" > "$release_payload" <<'JS'
const [tag, commit] = process.argv.slice(2);
process.stdout.write(JSON.stringify({
  tag_name: tag,
  target_commitish: commit,
  name: tag,
  draft: false,
  prerelease: false,
}));
JS
  status="$(curl --silent --show-error \
    --config "$auth_config" \
    --header 'Content-Type: application/json' \
    --output "$response" \
    --write-out '%{http_code}' \
    --request POST \
    --data-binary "@$release_payload" \
    "$api_url/releases")"
  if [ "$status" != "201" ]; then
    echo "Forgejo release creation failed with HTTP $status" >&2
    cat "$response" >&2
    exit 1
  fi
elif [ "$status" != "200" ]; then
  echo "Forgejo release lookup failed with HTTP $status" >&2
  cat "$response" >&2
  exit 1
fi

release_id="$(node - "$response" "${asset_names[@]}" <<'JS'
const fs = require("fs");
const [responsePath, ...names] = process.argv.slice(2);
const release = JSON.parse(fs.readFileSync(responsePath, "utf8"));
const existing = new Set((release.assets || []).map((asset) => asset.name));
const duplicates = names.filter((name) => existing.has(name));
if (duplicates.length) {
  console.error(`Release already has asset(s): ${[...new Set(duplicates)].sort().join(", ")}`);
  process.exit(1);
}
process.stdout.write(String(release.id));
JS
)"

upload_asset() {
  local path=$1
  local name
  local upload_status
  name="$(basename "$path")"
  upload_status="$(curl --silent --show-error \
    --config "$auth_config" \
    --output "$response" \
    --write-out '%{http_code}' \
    --form "attachment=@$path" \
    "$api_url/releases/$release_id/assets?name=$name")"
  if [ "$upload_status" != "201" ]; then
    echo "Forgejo asset upload failed for $name with HTTP $upload_status" >&2
    cat "$response" >&2
    return 1
  fi
  node - "$response" <<'JS'
const fs = require("fs");
const response = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
process.stdout.write(String(response.id));
JS
}

for asset in "${assets[@]}"; do
  asset_id="$(upload_asset "$asset")"
  uploaded_asset_ids+=("$asset_id")
  echo "Uploaded $(basename "$asset")"
done

uploaded_asset_ids=()
echo "Released $release_tag"
