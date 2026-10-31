# Release builds

- [Standalone builds](#standalone-builds)
- [Publication](#publication)

## Standalone builds

Run commands from a fresh app checkout with a prepared desktop and/or Android toolchain:

```sh
./scripts/build-release.sh           # desktop + universal Android APK
./scripts/build-release.sh desktop
./scripts/build-release.sh android
```

Artifacts land in `release/<version>/{desktop,android}/`, using the canonical `package.json` version. Desktop requires AppImage, deb, and rpm. Android builds only an APK, not AAB. Missing or ambiguous required outputs fail the build. Existing target output directories or old bundle/build output directories are refused rather than reused or deleted; preserve them and use a fresh checkout.

Standalone builds print `Release: Starting desktop build` and `Release: Starting Android build` to stderr for selected targets, then corresponding completion markers only after collecting their required artifacts. Tool output remains visible when running the standalone script directly; do not share it without checking for signing secrets.

Prepare local [Android signing files](android-signing.md) before building Android. The tracked Gradle project is used without reinitialization; Tauri generates ignored support files as part of its build. A standalone build is not proof of publication readiness or artifact provenance.

## Publication

The [guarded Forgejo publisher](forgejo-publishing.md) creates its own isolated checkout, installs locked npm dependencies, runs tests, rejects changes to tracked source, checks the expected APK signing certificate, and creates SHA-256 checksums. It does not reuse standalone artifacts. Completed releases are verified against their original tag-bound manifest without rebuilding. Actual publication requires separate approval.

The publisher displays [curated progress events](forgejo-publishing.md#progress-logs), not raw compiler/test output or the captured standalone target markers. Its combined build label lists selected targets and prints elapsed-time waiting updates every 15 seconds. This protects credentials without pretending to know which target is currently building.
