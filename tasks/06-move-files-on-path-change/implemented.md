# 06 - Move files on path change — Implemented

## Files changed

| File | Change |
|---|---|
| `src-tauri/src/commands.rs` | Added `move_file`, `rollback_moves`; updated `set_data_dir` to move existing files with full rollback |

## Summary of behavior

When `set_data_dir` is called with a new directory:
1. Existing `todo.txt` / `Note.md` at the old path are moved (renamed) to the new directory.
2. Cross-filesystem move falls back to copy + delete.
3. On any error, moved files are rolled back before returning.
4. Files that don't exist at the old path are silently skipped.
5. Same-directory changes are detected and skipped.

## Test results

- `cargo test`: 30 passed (28 existing + 2 new `move_file` tests)
- `npx vitest run`: 51 passed
- `npm run build`: clean
