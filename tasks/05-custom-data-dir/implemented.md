# 05 - Custom data directory — Implemented

## Files changed

| File | Change |
|---|---|
| `src-tauri/src/paths.rs` | Added `app_data_dir`, `resolve_data_dir`, `load_custom_data_dir`, `save_custom_data_dir` + private `read_custom_data_dir`, `write_custom_data_dir`; simplified `data_files`; 4 unit tests |
| `src-tauri/src/store.rs` | Added `Store::set_path` (delegates to `Store::load`); 2 unit tests |
| `src-tauri/src/note.rs` | Added `NoteStore::set_path` (delegates to `NoteStore::load`); 2 unit tests |
| `src-tauri/src/commands.rs` | Added `get_data_dir`, `set_data_dir` commands |
| `src-tauri/src/lib.rs` | Registered `get_data_dir`, `set_data_dir` in `generate_handler!` |
| `src/api.ts` | Added `getDataDir`, `setDataDir` |
| `src/components/SettingsModal.tsx` | Added "Data directory" section (local mode only) |
| `src/style.css` | Added `.settings-hint` style |

## Test results

- `cargo test -p app`: 28 passed (4 new paths tests, 2 new store tests, 2 new note tests)
- `npx vitest run`: 51 passed
- `npm run build`: clean
