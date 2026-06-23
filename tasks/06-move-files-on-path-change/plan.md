# 06 - Move files on path change

## Goal

When the user changes the data directory in Settings, automatically move the existing
`todo.txt` and `Note.md` from the old location to the new one, so no data is lost and
the user does not have to manually copy files.

## Motivation

Task 05 added a configurable data directory but left old files in place, requiring the
user to manually move them. That is friction-heavy for the common case (moving files to
Dropbox, a preferred folder, etc.) where the user simply wants their existing data to
follow the new path.

---

## Design

The entire change is in `src-tauri/src/commands.rs`. No frontend changes are needed;
the UI already calls `set_data_dir` and the move is transparent to the caller.

### Move semantics

A private helper `move_file(from: &Path, to: &Path) -> io::Result<()>`:

1. Attempt `fs::rename(from, to)` — atomic on the same filesystem, overwrites destination.
2. If that fails with `ErrorKind::CrossDevice` (source and destination on different
   filesystems), fall back to `fs::copy(from, to)` + `fs::remove_file(from)`.

Overwrite behavior: if the destination file already exists it is overwritten. The user
explicitly requested a path change, so their current in-memory data should win.

### Where to move files

`set_data_dir` currently captures `old_todo = store.path()`. The note's old path is
always `old_todo.parent().join(NOTE_FILE)` — both files live in the same directory and
are always set together by `paths::data_files` (an invariant of the app's layout). A
comment in `set_data_dir` will name this invariant explicitly so a future change to the
layout cannot break the derivation silently. This avoids adding a `path()` getter to
`NoteStore` for a single caller.

Only move a file if it exists at the old path **and** the old path differs from the new
path (same-directory no-ops are silently skipped).

### Updated `set_data_dir` sequence

```
1. Resolve new_dir (validate absolute path, create if absent)
2. Compute old_todo = store.path(), old_note = old_todo.parent()/NOTE_FILE
3. Compute new_todo = new_dir/TODO_FILE, new_note = new_dir/NOTE_FILE
4. If old_todo != new_todo and old_todo.exists():
     move_file(old_todo, new_todo)   ← rollback: move new_todo back on any later error
5. If old_note != new_note and old_note.exists():
     move_file(old_note, new_note)   ← rollback: move new_note back + undo step 4
6. Switch store.set_path(new_todo)   ← on failure: rollback 4+5
7. Switch note.set_path(new_note)    ← on failure: rollback store + 4+5
8. Persist config
```

Rollback is best-effort (`let _ = ...`) to avoid masking the original error. Known
limitation: if both a forward move and its rollback fail (e.g. the file is deleted by
another process between the move and the rollback), files may be lost. This window is
~10 ms and requires concurrent external interference, so it is accepted as an edge case
rather than solved with a more complex backup scheme.

---

## Files changed

| File | Change |
|---|---|
| `src-tauri/src/commands.rs` | Add private `move_file`; update `set_data_dir` to move files with rollback |

No other files change. The frontend, `paths.rs`, `store.rs`, `note.rs`, and `lib.rs` are
all unaffected.

---

## Tests

### `src-tauri/src/commands.rs` inline tests for `move_file`

- Same filesystem: file is at destination after move, absent at source.
- Destination overwrite: pre-existing destination file is replaced.
- Source absent: function succeeds (nothing to move — `exists()` guard in caller, but
  `move_file` itself is called only when file exists).

### Verification in `set_data_dir` (integration-level, manual)

- Change path when both files exist → both files appear at new location, absent at old.
- Change path when files are absent (fresh install) → no error, stores start empty at new location.
- Change to the same path → no files moved, no error.
- Change path across filesystems (if available) → copy+delete fallback, files at new location.

---

## Verification

- `cargo test -p app`: all existing 28 tests + new `move_file` tests pass.
- `npx vitest run`: 51 tests pass (no TS changes).
- `npm run build`: clean.
