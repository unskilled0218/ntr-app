# Review Implementation — 05 Custom Data Directory

## Fixes applied from code review round 1

### Warning 1: Knowledge Duplication — filename constants
Made `TODO_FILE` and `NOTE_FILE` `pub const` in `paths.rs`.
Replaced `"todo.txt"` / `"Note.md"` literals in `commands::set_data_dir` with `paths::TODO_FILE` / `paths::NOTE_FILE`.

### Warning 2: Change Propagation — partial-failure rollback
Added `pub fn path(&self) -> &Path` getter to `Store`.
In `set_data_dir`: captures old store path before switching, rolls back store if note switch fails.

### Suggestion: Cognitive Overload — duplicate async handlers
Extracted `applyDir(dir: string)` helper; `Save path` and `Reset to default` buttons both call it.

## Fixes applied from code review round 2

### Suggestion: `resolve_data_dir` silent fallback
Replaced `unwrap_or_else(|_| PathBuf::from("."))` with proper error propagation via `app_data_dir(app)`.

## Final test results

- `cargo test`: 28 passed, 0 failed
- `npx vitest run`: 51 passed, 0 failed
- `npm run build`: clean, no warnings
