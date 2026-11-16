# Publish a Forgejo release

- [Configuration](#configuration)
- [Credentials and tools](#credentials-and-tools)
- [Local checks](#local-checks)
- [Publication and verification](#publication-and-verification)
- [Progress logs](#progress-logs)
- [Failure and recovery](#failure-and-recovery)
- [API contract and limitations](#api-contract-and-limitations)

## Configuration

From the app directory, review `scripts/release.json`: repository, protected token-file path, notes, targets, and trusted Android certificate. `package.json` is the canonical version; npm/Cargo/Tauri mirrors and `docs/releases/<version>.md` must match. Notes start with `# Release v<version>`.

For Android, establish the [trusted signing identity](android-signing.md#trusted-certificate) first. Never put keys or passwords in configuration.

## Credentials and tools

Use the configured token-file path, or override its path with `GIT_TOKEN`; this variable is not a token value. The file must be user-owned, readable, regular, non-symlink, and mode `0600` or `0400`. The configured login must match the token owner and have identity-read/repository release rights. Git authentication is separate. Never put tokens in Git, arguments, `.env`, or shell history.

Verification needs Linux/POSIX, Bash, Python 3.11+, Git, trusted HTTPS, and credentials. New publication also needs supported Node/npm, Rust, native bundle tools, and Android SDK/NDK/JDK plus `apksigner` for Android. The publisher does not install tools, configure builders, or disable TLS. Unsupported legacy transport/environment overrides are refused.

## Local checks

```sh
npm run test:release
./scripts/release.sh --validate
```

Also run [application checks](development.md#checks). Validation uses local metadata only, not keys, credentials, network, or publication. Fixture tests do not certify live permissions or device compatibility.

## Publication and verification

After separate approval, use clean, already-pushed app `main` and exactly one configured fetch/push destination. Exclude other release writers on every checkout/machine; the local lock is not distributed.

```sh
./scripts/release.sh          # configured targets
./scripts/release.sh desktop
./scripts/release.sh android
```

The publisher builds the exact source in an isolated checkout, runs locked dependency installation/tests, refuses tracked source changes, and never reuses old artifacts. Desktop requires AppImage/deb/rpm; Android requires a universal APK with the expected certificate. Each artifact gets a SHA-256 checksum.

An annotated tag binds source/configuration/scripts/notes/targets and the complete asset manifest. The script pushes only that version tag without force, creates the release, uploads, and verifies downloaded bytes. It never pushes source. Different targets cannot extend an existing identity; use a new version instead.

A complete existing release is checked read-only against its original tag manifest, without rebuilds or key access. Changed source/configuration cannot claim that identity. Historical recovery is separate from current-source verification.

## Progress logs

Curated stage events go to stderr; verified final results go to stdout. Setup/tests/builds print elapsed waiting events every 15 seconds, not percentages or proof of progress. Raw compiler/test/Git/signing output, headers, credentials, and response bodies stay private. There is no raw-output flag or persistent log file.

Timeout/interruption stops labeled child process groups; Ctrl+C exits 130. Neither cancels remote writes already accepted nor permits automatic retry.

## Failure and recovery

Tag-only, release-only, conflicting, malformed, or incomplete state stops publication. Inspect actual state before separately approved manual recovery. Do not delete artifacts, rewrite tags, roll back accepted writes, or retry blindly. There is no automatic upload resume. A rerun of a fully completed release verifies it read-only.

## API contract and limitations

The client uses Forgejo's Gitea-compatible `/api/v1` identity/repository/release/asset APIs. Inventories require positive IDs, unique names, sizes, and browser download URLs; paginated reads use at most 50 entries per page. Unknown, repeated, ambiguous, or oversized evidence is refused.

Only same-origin HTTPS GET redirects under the release-download/attachment routes are followed. Cross-origin and write redirects never forward credentials; external object-storage redirects are unsupported. Limits: metadata 2 MiB, captured tool output 16 MiB, tags 64 KiB, assets 2 GiB each. Tool-output limits are checked after completion and at waiting intervals, not as a disk quota. Writes are never automatically retried.
