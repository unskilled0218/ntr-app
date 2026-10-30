# Android signing

- [Local storage](#local-storage)
- [Existing key migration](#existing-key-migration)
- [First key creation](#first-key-creation)
- [Trusted certificate](#trusted-certificate)
- [Builds and backups](#builds-and-backups)

## Local storage

Run commands from the app repository root. Keep `release.keystore` and `keystore.properties` in the local gitignored `android-signing/` directory. The directory must be user-owned mode `0700`; files must be user-owned regular non-symlink files mode `0600` (read-only `0400` is also accepted for build inputs). The Gradle signing configuration uses this directory, not the generated Android project directory.

Never commit, stage, push, upload, or log these files or their passwords. `.gitignore` prevents ordinary accidental staging; it is not encryption, does not stop `git add -f`, and does not untrack files already committed. The release publisher refuses tracked signing files. Public certificate fingerprints are not secrets and belong in tracked release configuration.

## Existing key migration

If you already have a key under `src-tauri/gen/android/`, preserve it. Set the existing key and properties to user-only permissions before migration. With `keytool` available:

```sh
./scripts/android-keystore.sh --migrate
```

This explicitly copies `release.keystore` and `keystore.properties`, verifies the certificate fingerprint and key bytes, refuses nonempty destinations, and leaves the originals intact. Legacy properties must use `storeFile=release.keystore` and plain supported `key=value` signing fields; unsupported escapes or paths require manual inspection. Back up and inspect the migrated files before separately removing legacy copies. The publisher never migrates or generates a key automatically.

## First key creation

Only if no existing app signing identity exists:

```sh
./scripts/android-keystore.sh --create
```

The helper prompts privately for a password, refuses existing signing files, creates the key with `keytool`, and prints only its public SHA-256 certificate fingerprint. Passwords are supplied to `keytool` through a restrictive temporary file, never command arguments. The generated properties contain the store/key passwords and must remain private. Use printable ASCII values; the helper encodes special characters for Java properties. Do not create a new key merely because an old one is unavailable: existing installations normally cannot update to an APK signed by a different key.

## Trusted certificate

After independently confirming that the key is the existing trusted app identity, display its public certificate fingerprint:

```sh
./scripts/android-keystore.sh --fingerprint
```

Set `android_certificate_sha256` in `scripts/release.json` to the lowercase 64-digit SHA-256 fingerprint and commit that public value. It starts as `null` because no trusted key was present when this workflow was added. Do not infer or update the expected fingerprint automatically from whichever key happens to be supplied during publication. Every new Android release must pass `apksigner verify --verbose --print-certs` and match the configured certificate before remote writes. Intentional fingerprint changes require explicit approval and an update-compatibility decision.

## Builds and backups

The publisher builds a universal signed APK only; AAB and Google Play App Signing are out of scope. It copies signing inputs into a private temporary isolated checkout, cleans temporary copies afterward, and leaves original files unchanged. A completed release is verified without signing-key access or build tools. Standalone builds also use `android-signing/`; the publisher adds strict permission and expected-certificate checks before publication.

Keep an encrypted backup of the keystore and passwords outside the checkout, preferably off-device. Losing them can prevent updates to existing installations. Never use the repository or release assets as the backup. Real-device install/update checks remain separate from signature verification.
