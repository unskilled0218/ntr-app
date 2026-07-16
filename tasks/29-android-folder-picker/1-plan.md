# 29 - GUI folder picker for the data directory (desktop + Android)

## Goal

Replace the "type the path by hand" data-directory control in the Settings modal with a real folder picker button, working on both desktop and Android. Today the user must type an absolute path into a text input (`src/components/SettingsModal.tsx:150-161`); we want a "Choose folder" button that opens the OS folder picker and sets the data directory from what the user selects.

## Why desktop and Android are not the same task

The data-directory feature is built entirely on filesystem paths: `set_data_dir` requires an absolute path, `paths.rs` and the two stores use `std::fs` over a `PathBuf`, and the config file records a path string (`src-tauri/src/commands.rs:184-259`, `src-tauri/src/paths.rs`, `src-tauri/src/store.rs`, `src-tauri/src/note.rs`).

Desktop fits this model. Tauri's dialog plugin opens a native folder picker on Linux/Windows/macOS and returns a real filesystem path, which flows straight into the existing `set_data_dir`.

Android does not. Tauri's dialog plugin explicitly does not support a folder picker on Android. The only Android directory picker (the Storage Access Framework intent `ACTION_OPEN_DOCUMENT_TREE`) returns a `content://` tree URI, not a path, and `std::fs` cannot read or write through it. Supporting Android therefore means giving the storage layer a second backend that talks to SAF, which is the architectural work this task signs up for (the chosen approach).

## The one seam: a file backend behind the two stores

Every place the app touches the local data files reduces to two primitives: read the whole file (missing = empty) and write the whole file atomically. `Store` and `NoteStore` already funnel all IO through exactly those two calls (`fs::read_to_string` in `load`/`reload_from_disk`, `atomicfile::write` in `save`/`replace`). We introduce that pair as a trait and give the stores an implementation instead of a `PathBuf`:

```
pub trait FileBackend: Send {
  fn read(&self, name: &str) -> io::Result<Option<String>>;   // Ok(None) == missing
  fn write(&self, name: &str, data: &str) -> io::Result<()>;  // whole-file, atomic where possible
}
```

`name` is `"todo.txt"` or `"Note.md"` (the two `paths::*_FILE` constants), so a single backend instance represents the whole data directory and both stores share it. The store logic above the IO line (todo.txt parsing, id assignment, write-then-swap, the note's plain-text compare) is unchanged; only the primitive underneath is swapped. This keeps the parse/render code still verbatim-aligned with the server (the "keep in sync" note in `store.rs`/`note.rs` covers the task/note contract, not the IO boundary, and stays true).

Two implementations:

- `FsBackend { dir: PathBuf }` (all platforms): `read` is `fs::read_to_string(dir.join(name))` with the existing "NotFound = empty" rule; `write` is `atomicfile::write(dir.join(name), data)`. This is desktop, iOS, and Android's default app-data directory.
- `SafBackend { app: AppHandle, tree_uri: String }` (Android only, `#[cfg(target_os = "android")]`): resolves (or creates) the child document `name` under the persisted tree URI via `tauri-plugin-android-fs` and reads/writes its bytes through the Android `ContentResolver`. SAF has no atomic rename, so `write` is a direct whole-file write; acceptable because the app is the single writer and the files are tiny.

`Store::load` / `NoteStore::load` change from `path: impl Into<PathBuf>` to `(backend: Arc<dyn FileBackend>, name: &'static str)`; `set_path` becomes `set_backend`. The stores keep the backend + their filename and call `backend.read(name)` / `backend.write(name, data)` where they call `fs` today. `path()` (used only by `set_data_dir` to derive the old note path) is replaced by the backend-move logic below, so it is removed.

## Where the location and its kind live

`config.json` already stores the chosen location as a string (`Config.data_dir`, `src-tauri/src/paths.rs:26-30`). We keep that field and distinguish the two kinds by prefix: a value starting with `content://` is a SAF tree URI, anything else is a filesystem path. This keeps existing desktop configs valid with no migration. `resolve_data_dir` returns the raw stored string; a new `backend_for(app, location)` builds an `FsBackend` for a path (or absent = app-data default) and a `SafBackend` for a `content://` URI.

## Rust changes

### New plugin wiring (`src-tauri/src/lib.rs`, `Cargo.toml`, capabilities)

- Add `tauri-plugin-dialog` (folder picker on desktop) and, android-only, `tauri-plugin-android-fs` (SAF) to `Cargo.toml`; register both plugins in the `Builder` (`android-fs` gated by `#[cfg(target_os = "android")]`).
- `src-tauri/capabilities/default.json` gains `dialog:default`; add an Android-scoped capability granting the `android-fs` permission (SAF grants are per-URI, so no broad `READ/WRITE_EXTERNAL_STORAGE` manifest permission is needed -- note this explicitly so we do not over-request).

### `src-tauri/src/backend.rs` (new)

The `FileBackend` trait and both impls, plus `backend_for(app, location: Option<&str>) -> Arc<dyn FileBackend>`. `FsBackend` is pure and unit-testable with a temp dir; `SafBackend` is `#[cfg(target_os = "android")]`.

### `src-tauri/src/paths.rs`

- `resolve_data_dir` returns the stored location string (path or `content://`) rather than only a `PathBuf`; the default stays the app-data directory as a path.
- `data_files` is retired in favour of `backend_for` returning a backend the stores load from; `app_data_dir` / config read+write stay (config always lives at a real app-data path, unaffected by SAF).

### `src-tauri/src/store.rs`, `src-tauri/src/note.rs`

Swap the `PathBuf` field and the direct `fs`/`atomicfile` calls for the shared `Arc<dyn FileBackend>` + filename, as described in the seam section. Existing tests keep working against an in-memory or temp-dir `FsBackend`.

### `src-tauri/src/commands.rs`

- `get_data_dir`: return a display string -- the path on desktop, the SAF folder's display name on Android (raw `content://` URIs are unreadable to a user). Add the display-name lookup via `android-fs`.
- New `pick_data_dir(app) -> Result<Option<String>, String>`: opens the native folder picker and returns the chosen location, or `None` if cancelled. Desktop uses `tauri-plugin-dialog`'s folder picker (real path); Android uses `android-fs` `ACTION_OPEN_DOCUMENT_TREE`, takes the persistable URI permission, and returns the tree URI. The command does not itself apply the choice -- the frontend then calls `set_data_dir` with it, keeping one apply path.
- New `storage_kind(app) -> "path" | "saf"`: lets the UI decide between an editable text field (desktop) and a picker-only read-only label (Android), without adding a JS platform plugin.
- `set_data_dir`: generalise to accept a path or a `content://` URI. The file-move-on-change logic (`move_file`, `rollback_moves`) becomes backend-aware: build the old and new backends, and "move" = for each of `todo.txt`/`Note.md`, read from the old backend and, if present, write to the new backend then delete the old copy (a real `fs::rename` when both sides are `FsBackend`, as an optimisation). Switch both stores to the new backend via `set_backend`, with the same rollback-on-failure discipline that exists today.

### `src-tauri/src/watch.rs`

Unchanged in shape -- it still calls `reload_from_disk` each second, now through the backend. Note: on Android each poll reads via SAF (more expensive than a stat), but the files are tiny; if it proves heavy we raise the Android poll interval. SAF has no cheap change notification, so polling stays the mechanism.

## Frontend changes

### `src/api.ts`

- `pickDataDir(): Promise<string | null>` -> `invoke("pick_data_dir")`.
- `getStorageKind(): Promise<"path" | "saf">` -> `invoke("storage_kind")`.
- `getDataDir` / `setDataDir` stay as they are (`setDataDir` already takes a string; it now also accepts a `content://` URI).

### `src/components/SettingsModal.tsx`

- Load `storageKind` alongside `getDataDir()` when the modal opens.
- Add a "Choose folder" button next to the Data directory control that calls `pickDataDir()`; on a non-null result, desktop fills the existing text input (user still clicks "Save path", keeping the current apply flow) while Android applies immediately via `applyDir(result)` since there is nothing to type.
- When `storageKind === "saf"` (Android): render the current folder as a read-only label (the display name from `get_data_dir`) instead of an editable text input -- typing a content URI is meaningless -- and keep "Choose folder" + "Reset to default". When `"path"` (desktop): keep the editable input exactly as today and add "Choose folder" beside "Save path" / "Reset to default".
- "Reset to default" still calls `applyDir("")` (empty -> app-data default) on both.

## What needs installing

Per AGENTS.md I will not install these myself -- please run:

- Rust (in `src-tauri/`): `cargo add tauri-plugin-dialog` and `cargo add tauri-plugin-android-fs --target 'cfg(target_os = "android")'` (latest v2-compatible; `android-fs` was 28.x/`^2` at time of writing).
- JS: none required -- picking is done in the Rust `pick_data_dir` command, so no `@tauri-apps/plugin-dialog` JS binding or OS plugin is needed. (If we later choose to pick from JS on desktop, that binding would be the only addition.)

Tell me if you would rather do the desktop picker from the JS side instead; it moves the folder dialog into the frontend and drops the Rust dialog dependency, at the cost of two code paths in the UI.

## Edge cases and risks

- A previously granted SAF permission can be revoked by Android (app data cleared, folder deleted). `backend.read/write` then errors; surfaced as the existing `dirError` status, and "Reset to default" recovers by returning to app-data.
- Cross-backend move on Android (app-data path -> SAF tree) copies bytes rather than renaming; a failure mid-move rolls back exactly as the path-to-path case does.
- `get_data_dir` returning a display name (not the raw URI) means the UI never shows an ugly `content://...`; the raw location stays server-side in `config.json`.
- Backward compatibility: existing desktop `config.json` files hold a plain path with no `content://` prefix, so they select `FsBackend` unchanged -- no migration.

## Tests

- `src-tauri/src/backend.rs`: `FsBackend` read-missing-is-none, write-then-read roundtrip, atomic write leaves no `.tmp`. (`SafBackend` is device-only; covered by manual Android verification.)
- `src-tauri/src/store.rs`, `note.rs`: existing suites re-pointed at an `FsBackend` over a temp dir; behaviour identical.
- `src-tauri/src/commands.rs`: `set_data_dir` path-to-path move still moves both files and rolls back on failure (existing tests, adapted to the backend move helper).
- `src/components/SettingsModal.test.tsx`: with `storageKind: "path"`, "Choose folder" fills the input and leaves applying to "Save path"; with `storageKind: "saf"`, the input is a read-only label and a picked folder applies immediately; a cancelled pick (`null`) changes nothing. Mock `pickDataDir` / `getStorageKind` in the api layer as the existing modal tests mock `getDataDir`.

## Out of scope

Redo of the conflict/server flow; iOS folder picking (iOS returns `file://` URIs and keeps the app-data default -- not requested); watching SAF folders for external edits beyond the existing 1s poll; multi-folder or per-file location choices.

## Verification

`npm test` and `cargo test` (in `src-tauri/`). Then drive both targets: on desktop, "Choose folder" opens the native picker, the chosen path fills the input, "Save path" moves `todo.txt`/`Note.md` and the list/note reload from the new location, and the status bar settles; "Reset to default" returns to app-data. On an Android build (`npm run tauri android dev`), "Choose folder" opens the SAF tree picker, the granted folder's display name appears, todo and note read/write there, the choice survives an app restart (persisted URI permission), and "Reset to default" returns to app-data.
