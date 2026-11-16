# Release builds

- [Standalone builds](#standalone-builds)
- [Publication](#publication)

## Standalone builds

From a fresh app checkout with prepared toolchains:

```sh
./scripts/build-release.sh           # desktop and universal Android APK
./scripts/build-release.sh desktop
./scripts/build-release.sh android
```

Outputs go to `release/<version>/{desktop,android}/`. Desktop needs AppImage/deb/rpm; Android produces APK, not AAB. Existing output directories or ambiguous/missing artifacts are refused, not deleted or reused. Use a fresh checkout.

Prepare [Android signing](android-signing.md). The tracked Gradle project is not reinitialized. Standalone builds show raw tool output; inspect it for secrets before sharing. Target start/completion markers do not prove publication readiness.

## Publication

The [guarded publisher](forgejo-publishing.md) builds its own isolated source, tests it, validates certificate/checksums, and binds artifacts to a tag. It does not reuse standalone outputs. Publication needs separate approval; local builds do not publish anything.
