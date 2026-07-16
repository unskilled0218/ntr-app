# 28 - Implemented

## Summary

Implemented note-scoped Ctrl/Cmd+Z, Ctrl/Cmd+X, and Ctrl/Cmd+C handling for the contenteditable note editor.

## Changes

- Added note undo configuration: `NOTE_UNDO_COALESCE_MS` and `NOTE_UNDO_LIMIT`.
- Added `src/lib/history.ts` for logical-text undo snapshots with typing coalescing, chunk boundaries, reset, and capped retention.
- Added `src/lib/noteEdit.ts` for current-line bounds and cut/copy range arithmetic.
- Added `src/lib/clipboard.ts` with `navigator.clipboard.writeText` and `execCommand("copy")` fallback.
- Wired `NotePane` to:
  - reset undo history when adopting loaded or remote text,
  - record typing, structural edits, paste, cut, and IME composition commits,
  - undo through logical text snapshots and autosave the result,
  - copy/cut selected text or the current line when the selection is collapsed,
  - keep Ctrl/Cmd+Shift+Z, Ctrl/Cmd+Alt combinations, and other modified shortcuts outside this handler.
- Bumped app version from `0.15.1` to `0.15.2`.

## Tests

- Added unit coverage for undo history behavior, note line/range editing behavior, and clipboard fallback behavior.
- Extended `NotePane` tests for Ctrl+C, Ctrl+X, Ctrl+Z, remote-adopt reset behavior, and Ctrl+Shift+Z fall-through.

## Verification

- `npm test` passed: 27 files, 227 tests.
- `npm run build` passed.
