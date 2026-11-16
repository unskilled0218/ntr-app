# Publish a Forgejo release

- [Configuration](#configuration)
- [Credentials and tools](#credentials-and-tools)
- [Local checks](#local-checks)
- [Publication and verification](#publication-and-verification)
- [Progress logs](#progress-logs)
- [Failure and recovery](#failure-and-recovery)
- [API contract and limitations](#api-contract-and-limitations)

## Configuration

Run commands from the app repository root. `scripts/release.json` selects the HTTPS Forgejo origin, repository, token owner, private token file, notes, targets, and expected Android signing certificate. `package.json` is the canonical version; both npm lockfile root versions, Tauri configuration, Cargo manifest, and the app's Cargo lockfile entry must match. Notes must be `docs/releases/<version>.md` and start with `# Release v<version>`.

The checked-in Android certificate is initially `null`: no existing key was available to establish a trusted fingerprint. This is a visible setup requirement, not a generated identity. New Android publication refuses until you establish and commit the trusted public fingerprint described in [Android signing](android-signing.md). Never put the keystore or passwords in release configuration.

## Credentials and tools

Use a user-owned, readable, non-symlink token file outside the repository with mode `0600` or `0400`, default `~/.config/token/git`. `GIT_TOKEN` selects a token file path, not a token value. The configured username must match the token's `/api/v1/user` identity. The token needs user-identity read access and repository write/release rights; Git transport authentication is separate. Old `FORGEJO_TOKEN` and `FORGEJO_API_URL` overrides are refused. Tokens must not appear in Git, command arguments, logs, `.env`, or shell history.

Verification needs Linux/POSIX, Bash, Python 3.11+, Git, normal trusted HTTPS, and API/Git credentials. New publication additionally needs Node/npm, Rust/Cargo, the desktop bundling toolchain, and the Android SDK/NDK/JDK and `apksigner` on `PATH` for Android. The publisher does not install system tools, configure builders, or disable TLS. It runs `npm ci` from the lockfile inside an isolated source checkout. Use a trusted toolchain and a normal trusted Git configuration; unsupported transport/environment overrides are refused.

## Local checks

```sh
python3 -B -m unittest discover -s tests -p 'test_release*.py' -v
bash -n scripts/release.sh
bash -n scripts/build-release.sh
bash -n scripts/android-keystore.sh
./scripts/release.sh --help
./scripts/release.sh --validate
npm test
npm run test:task-contract
npm run build
git diff --check
```

`--validate` uses local files only: it checks configuration, version mirrors, and notes without credentials, signing keys, build tools, or network access. It reports the unset certificate separately; it does not certify readiness to publish. Tests use temporary Git repositories and simulated services/tools, not a real Forgejo release or device installation.

## Publication and verification

Publication needs separate approval. Use clean, already-pushed app `main` with exactly one configured fetch and push destination for `ntr/ntr-app`. Exclude other release writers, including other machines and checkouts; the local lock alone cannot coordinate them. The command never pushes source or unrelated tags.

```sh
./scripts/release.sh          # configured targets: desktop and android
./scripts/release.sh desktop
./scripts/release.sh android
```

Before requiring build tools or signing files, the publisher reads remote tag/release state. An absent tag and release permits testing and building from the exact source in a fresh temporary checkout. Existing ignored build outputs are not reused. The tracked Android project is preserved; only Tauri's ignored support files may be generated. Tracked source changes during setup or builds stop publication. The required desktop set is one AppImage, one deb, and one rpm; Android requires one universal APK with the expected signing certificate. No AAB is built or published. Each artifact has a SHA-256 checksum file; names must be safe and unique.

The publisher binds source, configuration/scripts/notes hashes, selected targets, and the complete asset manifest to an annotated tag. It pushes only `v<version>` without force, creates a notes-based release, uploads the artifacts/checksums, and downloads remote bytes to verify their names, sizes, and hashes. Different target selections cannot incrementally extend an existing release: use a new version if the intended target set changes.

A complete existing release follows a separate read-only path. It verifies the original canonical manifest in the annotated tag, metadata, and all asset bytes without running tests, installing dependencies, rebuilding, or opening signing files. A completed-release check still requires the exact source and release identity on clean already-pushed `main`; it is not a historical-release recovery command.

## Progress logs

`scripts/release.sh` prints flushed `Release:` stage events to stderr before checks, setup, tests, builds, publication, and verification. Successful stages show elapsed seconds. Each asset upload and download verification shows its validated name and position in the inventory. Existing releases announce read-only verification without building or writing. Final verified results stay on stdout; they appear only after all integrity and stability checks pass.

Dependency installation, JavaScript tests, Rust tests, and the combined build print waiting events every 15 seconds while pending, including when stderr is redirected. These events show elapsed time, not percentages or evidence that the tool is making progress. The combined build label lists selected targets; it does not claim which target is currently building. Other operations announce starts and completions but do not emit periodic waiting events. `--help` and `--validate` do not start publication progress reporting.

Raw compiler, test, Git, and signing-tool output remains private even on failure. Logs never dump command arguments, environment values, credential paths, signing-file contents, HTTP headers, or response bodies. There is no raw-output flag or persistent log file. Failures identify the safe stage without replaying captured output. A timeout or Ctrl+C during a labeled setup/test/build command stops its process group; Ctrl+C exits with status 130. This does not undo remote writes or authorize retries.

## Failure and recovery

Tag-only, release-only, malformed, conflicting, or incomplete states stop without building or writing. Source/configuration/notes/target changes cannot claim an existing identity. Legacy tags without the canonical payload are refused rather than rewritten. Unpublished local version tags also require manual inspection.

Any failed or lost write response can leave accepted remote changes. No assets, releases, or tags are automatically deleted, no source is pushed, and tags are never force-pushed. Do not blindly retry writes or replace artifacts with rebuilt APKs. Inspect the exact remaining state and obtain separate approval for manual recovery. If the last write actually completed the entire release, a rerun verifies it read-only. There is no automatic partial-upload resume or destructive rollback.

## API contract and limitations

The client uses Forgejo's Gitea-compatible `/api/v1/version`, `/api/v1/user`, repository, release-by-tag, release creation, asset listing, and multipart asset upload APIs. Asset records must expose positive integer IDs, unique names, sizes, and `browser_download_url`. Asset listing accepts pages of at most 50 records and ends on a short page; bounded unpaginated small inventories also work. Unknown shapes, repeated pages, ambiguous identities, and excessive inventories are refused.

The attachment metadata endpoint returns JSON, not asset bytes. Verification downloads the returned same-origin browser URL under the repository's release-download route or `/attachments/<id>`. Only same-origin HTTPS GET redirects are followed; cross-origin redirects and all write redirects are refused without forwarding credentials. Deployments that use external object-storage download redirects are unsupported. Metadata is bounded to 2 MiB, accepted captured tool output to 16 MiB, tags to 64 KiB, assets to 2 GiB each, and the release inventory to the required packages and checksums. The tool-output limit is checked after completion and at waiting intervals for labeled commands, not as a strict disk quota. Writes are never automatically retried. Temporary tool output is withheld to avoid leaking signing/API credentials; only curated progress events are displayed.

Local tests do not attest the deployed Forgejo version, attachment configuration, upload size limits, account permissions, or device update behavior. Review those capabilities and perform separately approved integration checks before actual publication. No live API compatibility or publication is implied by local validation.
