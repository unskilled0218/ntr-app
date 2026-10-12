# Release builds

Run commands from the app repository root.

```sh
scripts/build-release.sh           # desktop + android
scripts/build-release.sh android   # android only
```

Artifacts land in `release/<version>/{desktop,android}/`.

See [Android signing](android-signing.md) for installable Android builds and [Forgejo publishing](forgejo-publishing.md) to publish artifacts.
