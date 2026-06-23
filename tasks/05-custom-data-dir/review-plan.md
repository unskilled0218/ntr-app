# Review Plan — 05 Custom Data Directory

## Round 1 findings to fix

### Warning 1: Knowledge Duplication — filename constants
- Make `TODO_FILE` and `NOTE_FILE` `pub const` in `paths.rs`
- Replace `"todo.txt"` and `"Note.md"` literals in `commands::set_data_dir`

### Warning 2: Change Propagation — partial-failure inconsistent state
- Add `pub fn path(&self) -> &Path` getter to `Store` (store.rs)
- Add `pub fn path(&self) -> &Path` getter to `NoteStore` (note.rs)
- In `set_data_dir`: capture store's old path, rollback if note switch fails

### Suggestion: Cognitive Overload — duplicate async handlers
- Extract `async fn apply_dir(dir: &str)` in SettingsModal
- (Will fix as part of the cleanup since it's one-liners)
