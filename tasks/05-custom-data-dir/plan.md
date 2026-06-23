# 05 - Custom data directory

## Goal

Allow the user to set a custom directory path where `todo.txt` and `Note.md` are stored,
so they can access and edit these files with external tools (editors, Dropbox, sync clients,
etc.). When no custom path is set the app uses its internal data directory as before.

## Motivation

The default Tauri app-data directory is buried in OS-managed paths that are hard to find and
impossible to point a sync client at. Exposing a configurable path lets users keep their
files in `~/Documents`, a Dropbox folder, or any other accessible location.

---

## Design

### Persistence — `src-tauri/src/paths.rs` (modified)

The custom directory is persisted in a JSON config file that always lives in the Tauri
app-data directory (the fixed, never-user-configurable location). Separating the config's
home from the data directory means a user can change the data dir and the config is still
found.

Config file: `{app_data_dir}/config.json`
Schema: `{ "data_dir": "/absolute/path" }` — field absent means "use default".

Config writes use `atomicfile::write` (temp+rename), matching the existing discipline in
`store.rs` and `note.rs`. A crash mid-write cannot corrupt the config.

New public surface:

```rust
/// The fixed app-data directory (always used for the config file itself).
pub fn app_data_dir(app: &AppHandle) -> io::Result<PathBuf>

/// Resolve the data directory to use for todo.txt and Note.md.
/// Returns the custom path from config if set, otherwise the app-data dir.
pub fn resolve_data_dir(app: &AppHandle) -> io::Result<PathBuf>

/// Read the stored custom data directory (None = not set / use default).
pub fn load_custom_data_dir(app: &AppHandle) -> io::Result<Option<PathBuf>>

/// Persist a custom data directory. Pass None to clear (revert to default).
pub fn save_custom_data_dir(app: &AppHandle, dir: Option<&Path>) -> io::Result<()>
```

`load_custom_data_dir` and `save_custom_data_dir` are thin wrappers that resolve the
config file path via `app_data_dir`, then delegate to private helpers:

```rust
fn read_custom_data_dir(config_path: &Path) -> io::Result<Option<PathBuf>>
fn write_custom_data_dir(config_path: &Path, dir: Option<&Path>) -> io::Result<()>
```

The private helpers take a `&Path` and have no Tauri dependency, so they are testable
directly with a temp path in `cargo test`.

`data_files` is simplified to call `resolve_data_dir`.

### Path-change on stores — `src-tauri/src/store.rs` and `src-tauri/src/note.rs` (modified)

Each store gets a `set_path` method. Rather than duplicating the file-reading logic that
`load` already owns, `set_path` re-initialises the whole store from the new path:

```rust
// Store
pub fn set_path(&mut self, new_path: PathBuf) -> io::Result<()> {
  *self = Store::load(new_path)?;
  Ok(())
}

// NoteStore
pub fn set_path(&mut self, new_path: PathBuf) -> io::Result<()> {
  *self = NoteStore::load(new_path)?;
  Ok(())
}
```

This delegates entirely to the existing load path: "missing = empty" semantics, error
handling, and any future changes to encoding all stay in one place. IDs are re-assigned
from 1 as in a fresh load; any task IDs held by callers before the call must be discarded.

Semantics: existing files at the old path are left untouched (no auto-migration). If the
new path already contains a file it becomes the live content; if it is absent the app
starts empty at that location. This matches the use case (point at a folder that already
has your files, or start fresh there).

### Tauri commands — `src-tauri/src/commands.rs` (modified)

Two new commands, following the same lock / map-err pattern as existing commands:

```rust
#[tauri::command]
pub fn get_data_dir(app: AppHandle, state: State<'_, AppState>) -> Result<String, String>
```
Returns the currently active data directory as an absolute path string.

```rust
#[tauri::command]
pub fn set_data_dir(app: AppHandle, state: State<'_, AppState>, dir: String) -> Result<(), String>
```
- If `dir` is empty: clears custom setting, switches both stores to the default dir.
- Otherwise: validates it is an absolute path, creates it if absent, switches stores,
  persists config via `save_custom_data_dir`.
- Locks `store` then `note` sequentially (consistent ordering — same as everywhere else
  in the codebase — to avoid deadlock potential as the app grows).

### Command registration — `src-tauri/src/lib.rs` (modified)

Add `commands::get_data_dir` and `commands::set_data_dir` to `generate_handler!`.

### Frontend API — `src/api.ts` (modified)

Two new exports that call the Tauri commands in local mode. In server mode the data dir
is a server-side concern and these are never called by the UI.

```ts
export function getDataDir(): Promise<string> {
  return invoke("get_data_dir");
}

export function setDataDir(dir: string): Promise<void> {
  return invoke("set_data_dir", { dir });
}
```

### Settings UI — `src/components/SettingsModal.tsx` (modified)

Add a "Data directory" section below the existing "Connection" section. The section is
only rendered when `getServerUrl()` is empty (local mode), because in server mode the
data directory is the server's concern.

State added:
```ts
const [dirInput, setDirInput] = useState("");
const [dirError, setDirError] = useState("");
```

On open (`useEffect([open])`): call `getDataDir()` and populate `dirInput`.

Interactions:
- **Save path** button: calls `setDataDir(dirInput.trim())`, closes modal on success,
  shows inline error on failure.
- **Reset to default** button: calls `setDataDir("")`, closes modal on success.

The existing Connection section and its buttons are unchanged.

---

## Files changed

| File | Change |
|---|---|
| `src-tauri/src/paths.rs` | Add `app_data_dir`, `resolve_data_dir`, `load_custom_data_dir`, `save_custom_data_dir` + private `read_custom_data_dir`, `write_custom_data_dir`; simplify `data_files` |
| `src-tauri/src/store.rs` | Add `Store::set_path` (delegates to `Store::load`) |
| `src-tauri/src/note.rs` | Add `NoteStore::set_path` (delegates to `NoteStore::load`) |
| `src-tauri/src/commands.rs` | Add `get_data_dir`, `set_data_dir` |
| `src-tauri/src/lib.rs` | Register new commands |
| `src/api.ts` | Add `getDataDir`, `setDataDir` |
| `src/components/SettingsModal.tsx` | Add data-directory section (local mode only) |

No changes to `config.ts`, `settings.ts`, `App.tsx`, `NotePane.tsx`, `TodoPane.tsx`, or
tests other than those noted below.

---

## Tests

### `src-tauri/src/paths.rs` (inline tests)

Tests call the private `read_custom_data_dir` / `write_custom_data_dir` helpers directly
(they take `&Path`, no `AppHandle` needed) so they run under plain `cargo test`:

- `read_custom_data_dir` returns `None` when config file is absent.
- `write_custom_data_dir(Some(path))` then `read_custom_data_dir` returns the same path.
- `write_custom_data_dir(None)` then `read_custom_data_dir` returns `None`.
- Config file at `{tmp}/config.json` is written atomically (verify by checking the file
  exists after `write_custom_data_dir` and is valid JSON).

### `src-tauri/src/store.rs` (extend existing inline tests)

- `set_path` to a path that has no file → store becomes empty.
- `set_path` to a path that already has content → that content is loaded.

### `src-tauri/src/note.rs` (extend existing inline tests)

- `set_path` to path with no file → content becomes `""`.
- `set_path` to path with existing content → content is loaded.

---

## Verification

- `cargo test -p app` (Rust unit tests) pass.
- `npx vitest run` (TS unit tests) pass.
- `npm run build` → TypeScript clean, Vite bundles.
- Manual: Settings → Data directory field shows current path. Enter a new absolute path →
  saved. Re-open Settings → new path shown. Files are created at new location on first
  write. Reset to default → reverts to original app-data path.
