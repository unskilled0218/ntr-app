# 29 - Implemented

Implemented the settings data-directory picker across the Tauri backend and React settings modal.

## Backend

- Added `src-tauri/src/backend.rs` with a shared `FileBackend` trait, `FsBackend`, Android-only `SafBackend`, backend resolution, SAF display-name lookup, and Android directory picking.
- Converted `Store` and `NoteStore` from direct `PathBuf` file IO to shared backend instances while preserving missing-file-is-empty semantics, whole-file writes, reload polling, and ID reset behaviour.
- Changed data-directory config storage from `PathBuf` to a raw string so existing filesystem paths and Android `content://` tree URIs can both be persisted.
- Registered `tauri-plugin-dialog` on all targets and `tauri-plugin-android-fs` on Android only.
- Added `pick_data_dir` and `storage_kind` commands.
- Updated `get_data_dir` to return a display value for SAF locations and the raw path for filesystem locations.
- Reworked `set_data_dir` to validate filesystem paths, accept SAF URIs, move `todo.txt` and `Note.md` through backend reads/writes/removes, switch both stores to the new backend, and roll back best-effort on failures.
- Added an Android-only capability for `android-fs:all`; no broad Android storage manifest permission is requested because SAF access is granted per selected URI.

## Frontend

- Added `pickDataDir()` and `getStorageKind()` to `src/api.ts`.
- Updated `SettingsModal` so desktop keeps the editable path input and "Choose folder" fills it before "Save path"; Android/SAF shows a read-only folder label, "Choose folder" applies immediately, and reset still uses `setDataDir("")`.
- Added read-only folder display styling.
- Added SettingsModal tests for desktop picker fill, SAF immediate apply, and cancelled picker no-op.

## Version

- Bumped package, Tauri config, and Cargo package version to `0.15.3`.

## Verification

- `cargo test` passed: 38 tests.
- `npm test -- --run` passed: 27 files, 230 tests.
- `npm run build` passed.
- `cargo check --target aarch64-linux-android` could not run because the `aarch64-linux-android` Rust target is not installed locally. Install with `rustup target add aarch64-linux-android` to run that check.
