# Android signing

- [Local storage](#local-storage)
- [Existing key migration](#existing-key-migration)
- [First key creation](#first-key-creation)
- [Trusted certificate](#trusted-certificate)
- [Missing fingerprint error](#missing-fingerprint-error)
- [Builds and backups](#builds-and-backups)

## Local storage

Keep `release.keystore` and `keystore.properties` in local, gitignored `android-signing/`. The directory must be user-owned mode `0700`; files must be user-owned, regular, non-symlink files with mode `0600` or read-only `0400`. Gradle uses this directory, not generated Android-project paths.

Never commit, upload, or log keys/passwords. Ignore rules are not encryption and do not untrack committed secrets. The publisher refuses tracked signing files. Public certificate fingerprints are safe to commit.

## Existing key migration

Preserve an existing key under `src-tauri/gen/android/`. After restricting its permissions, run from the app directory:

```sh
./scripts/android-keystore.sh --migrate
```

The helper verifies copied key bytes/fingerprint, refuses nonempty destinations, and leaves originals intact. Legacy properties require `storeFile=release.keystore` and supported plain `key=value` fields. Inspect unusual paths/escapes manually and back up before removing originals.

## First key creation

Only for a genuinely new signing identity:

```sh
./scripts/android-keystore.sh --create
```

The helper privately prompts, refuses existing files, and prints only the public fingerprint. It passes passwords through a protected temporary file, not arguments. Properties contain private passwords; use printable ASCII values.

Losing an established key normally prevents updates to existing installations. A replacement fingerprint does not bypass Android's signature checks. Recover the original key if possible; otherwise back up/export user data before uninstall/reinstall, or distribute a separate application identity. A key change needs explicit approval and a compatibility decision.

## Trusted certificate

Independently confirm the intended signing identity, then run:

```sh
./scripts/android-keystore.sh --fingerprint
```

Set `android_certificate_sha256` in `scripts/release.json` to the lowercase 64-digit SHA-256 value. Commit/push this public setting before publication. Never accept whichever key happens to be supplied automatically. The publisher verifies the APK with `apksigner verify --verbose --print-certs` before remote writes.

## Missing fingerprint error

For `Set trusted Android certificate fingerprint before building`, follow the printed command:

```sh
bash scripts/android-keystore.sh --fingerprint
```

See [trusted certificate setup](#trusted-certificate). The command does not edit configuration. Prepare existing signing files first; do not generate a replacement merely because a trusted key is unavailable. `--validate` and error guidance do not open keys or run setup.

## Builds and backups

The publisher builds a universal APK, not AAB. Temporary signing copies stay private and are cleaned afterward; originals remain unchanged. Completed-release verification needs no signing-key access. Real-device install/update checks remain separate.

Keep encrypted off-device backups of the keystore and passwords. Never use Git or release attachments as the backup.
