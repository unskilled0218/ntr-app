# 27 - Implemented

## Summary

Implemented note-editor ownership of Space and Tab input. Space now inserts a literal space into the logical note text, Tab inserts a literal tab, Enter remains handled through the same path, and Shift+Tab is left to browser focus navigation. The splice path is selection-aware, so typed inserts replace non-collapsed selections instead of inserting at the selection start.

## Changes

- Added `getCaretRange(root)` in `src/lib/caret.ts` and refactored caret offset calculation through a shared boundary-point helper.
- Updated `NotePane` to use `getCaretRange` for `spliceNote`, guard handled keys during composition and modifier shortcuts, intercept Space, intercept forward Tab, and preserve Shift+Tab.
- Changed blank-line Markdown rendering so whitespace-only lines emit their escaped whitespace instead of `<br>`, preserving THE LINE INVARIANT.
- Added `tab-size: 2` to `.note-input`.
- Bumped app version metadata to `0.15.1` in `package.json`, `package-lock.json`, and `src-tauri/tauri.conf.json`.

## Tests

- Added Markdown invariant coverage for space-only and tab-only lines.
- Added caret range tests for multi-line selections, collapsed ranges, and selections outside the editor.
- Added NotePane tests for Space insertion without line splitting, Space on an empty note with autosave, Tab insertion and Shift+Tab pass-through, selection replacement, and composing Space pass-through.

## Verification

- `npm test` passed: 24 files, 205 tests.
- `npm run build` passed.
