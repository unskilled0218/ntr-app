# 20 - Click outside a modal to close it — implemented

Implemented as planned, with the plan-review's one readability tidy applied (the
dismiss is a named `const dismiss = ...` rather than an inline IIFE).

## Changes

- **`src/components/useBackdropClose.ts`** (new) — the single home for "click
  outside closes": an effect that attaches a `click` listener to the dialog and,
  when `e.target === dialog` (a backdrop click), runs `onClose` if given else the
  dialog's own `close()`. ~14 lines.
- **`src/components/usePickerDialog.ts`** — calls `useBackdropClose(dialogRef)`
  once; SelectField, SortField and OptionsModal inherit backdrop dismissal with no
  per-component change (their `onClose={() => setOpen(false)}` converts the native
  close into picker state).
- **`SettingsModal.tsx`**, **`EditTaskModal.tsx`** — `useBackdropClose(dialogRef,
  onClose)`: these drive open/closed through a parent prop and `preventDefault()`
  the cancel event, so the backdrop routes through `onClose` (not a raw
  `dialog.close()`) to keep parent state authoritative — the same path Escape took.
- **`LabelModal.tsx`**, **`ConflictDialog.tsx`**, **`NoteConflictDialog.tsx`**,
  **`RemoveLabelDialog.tsx`** — `useBackdropClose(dialogRef)` (default path); the
  existing `close`-event-wired `onClose`/`onDismiss`/`onCancel` does the dismiss.
  Updated `LabelModal`'s lead comment to mention backdrop dismissal (the
  Conflict/RemoveLabel comments already claimed it and are now true).

Version 0.8.0 -> 0.9.0 (package.json, tauri.conf.json, Cargo.toml, Cargo.lock).

No CSS, no `src-tauri/`, no dialog body markup changed.

## Tests (3 suites updated, +5 cases; covering the three wiring variants)

- **SelectField.test.tsx** — picker/default path: clicking the dialog element
  closes it; clicking inner content (the title) does not. Covers SortField /
  OptionsModal too (same hook).
- **RemoveLabelDialog.test.tsx** — default native-close path: a backdrop click
  fires `onCancel` (via `dialog.close()` -> native `close`).
- **SettingsModal.test.tsx** — state-driven override path: a backdrop click fires
  the `onClose` prop; an inner-content click does not.

## Verification

- `npm run build` (tsc + vite): passes; `ntr@0.9.0`; 58 modules.
- `npm test`: 20 files, **150 tests** pass (was 145). The pre-existing `stderr`
  lines in `api.test.ts` are that suite's deliberate failure-path logging, not new.
