# 20 - Click outside a modal to close it

## Goal

Every modal in the app is a native `<dialog>` opened with `showModal()`. That gives
a focus trap, a `::backdrop`, and Escape-to-dismiss — but **not** click-outside-to-
dismiss (the platform does not close a dialog when its backdrop is clicked). So
today a click on the dark backdrop does nothing; the user must press Escape or hit
Cancel/Done. Add the expected behaviour: **a click outside the dialog box closes
it**, with the same effect as that dialog's existing dismiss (Escape / Cancel).

Two component comments (`ConflictDialog`, `RemoveLabelDialog`) already *claim*
"Escape / backdrop" dismissal — that claim is currently false. This task makes it
true and corrects `LabelModal`'s comment to match.

## The single new idea — capture it once

"Click outside closes" is **one** decision. With nine `<dialog>`s it must not be
re-spelled nine times (that is exactly the Knowledge Duplication this codebase
avoids). The decision lives in **one** new hook and every dialog opts in with a
single line.

### Why a hook, not a `<Modal>` wrapper

A shared `<Modal>` component that wraps each dialog's body would be the tempting
"DRY" move, but task 18's review already rejected extracting a modal-body wrapper:
the nine dialogs have very different bodies (forms, picker lists, conflict
previews) and a wrapper would be a shallow component slotting `children` between
fixed chrome. Backdrop dismissal is a **behaviour**, not markup, so the right grain
is a behaviour hook attached to an existing `dialogRef` — no markup moves, each
dialog keeps its own body verbatim.

### How native `<dialog>` makes this a one-liner

In a modal `<dialog>`, the `::backdrop` is painted by the dialog element itself, so
a click on the backdrop dispatches a `click` whose `target` **is the `<dialog>`
element**; a click on any inner control has that control as its target and merely
bubbles through. So "was this click on the backdrop?" is exactly
`e.target === dialogEl`. This is the canonical detection, needs no geometry, and —
crucially — is testable under the existing jsdom `<dialog>` polyfill
(`src/test/setup.ts`).

Nesting is handled for free by the same check: `LabelModal` renders inside
`EditTaskModal`'s `<dialog>`, and `SelectField` opens inside `SettingsModal` /
`OptionsModal`. A click on an inner dialog's backdrop has the inner dialog as its
target; it bubbles up to the outer dialog's listener, where `e.target` is the
*inner* dialog (≠ the outer) and is correctly ignored. Each listener only ever
acts on its own backdrop.

## The hook: `src/components/useBackdropClose.ts` (new)

Colocated with the dialogs in `components/` (same home as `usePickerDialog`, which
this codebase moved out of the framework-agnostic `lib/` in task 18).

```ts
import { useEffect, type RefObject } from "react";

// Dismiss a modal <dialog> when the user clicks outside its box (the backdrop). A modal dialog
// paints its own ::backdrop, so a click there lands on the dialog element itself while a click on
// any inner control targets that control — hence `e.target === dialog` is "clicked the backdrop".
// One home for "click outside closes", wired by every dialog. By default it calls the dialog's own
// close(), whose native `close` event each dialog already handles; the two dialogs that drive
// open/closed through React state (SettingsModal, EditTaskModal) pass their own close instead, so
// that state stays the single source of truth.
export function useBackdropClose(dialogRef: RefObject<HTMLDialogElement | null>, onClose?: () => void) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) (onClose ?? (() => dialog.close()))();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, [dialogRef, onClose]);
}
```

### Why the optional `onClose`, and why the default is `dialog.close()`

The codebase already has two close conventions, and the hook must respect both
without changing either:

- **Native-close dialogs** wire the dialog's `close` event to their dismiss, so
  letting the backdrop call `dialog.close()` runs that exact handler — one path,
  no duplication. These pass **no** argument (use the default):
  `usePickerDialog` (SelectField / SortField / OptionsModal — their `<dialog
  onClose={() => setOpen(false)}>`), `LabelModal`, `ConflictDialog`,
  `NoteConflictDialog`, `RemoveLabelDialog`.
- **React-state-driven dialogs** (`SettingsModal`, `EditTaskModal`) deliberately
  `preventDefault()` the `cancel` (Escape) event and close by flipping a parent
  prop, with **no** `close`-event handler. Calling `dialog.close()` on them would
  close the element while the parent's `open`/`task` state stayed true — a desync
  that wedges the reopen. So they pass their existing `onClose` callback, and the
  backdrop takes the identical path Escape already takes.

This is not speculative generality: the parameter exists because exactly two real
dialogs need it today, and the default serves the other seven. The asymmetry
mirrors a close-convention split that predates this task.

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| "Click outside closes" detection + dismiss | **new `useBackdropClose`** (`src/components/useBackdropClose.ts`) | Add |
| Backdrop dismissal for all three self-opening pickers | `src/components/usePickerDialog.ts` | Call `useBackdropClose(dialogRef)` once — SelectField/SortField/OptionsModal inherit it |
| Backdrop dismissal, native-close dialogs | `LabelModal`, `ConflictDialog`, `NoteConflictDialog`, `RemoveLabelDialog` | One `useBackdropClose(dialogRef)` line each |
| Backdrop dismissal, state-driven dialogs | `SettingsModal`, `EditTaskModal` | One `useBackdropClose(dialogRef, onClose)` line each |
| Stale "backdrop" doc comments | `LabelModal` (add), `ConflictDialog` / `RemoveLabelDialog` (now accurate) | Comment touch-up |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bump 0.8.0 -> 0.9.0 (done) |

No CSS change (the `::backdrop` is already styled), no `src-tauri/` change, no
change to any dialog's body markup or to how any dialog opens.

## Per-file edits

- **`usePickerDialog.ts`**: import and call `useBackdropClose(dialogRef)` after the
  existing show/close effect. All three pickers gain backdrop dismissal with zero
  per-component change; their `onClose={() => setOpen(false)}` already converts the
  native close into picker state.
- **`SettingsModal.tsx`** / **`EditTaskModal.tsx`**: add
  `useBackdropClose(dialogRef, onClose)`. (Both already have `dialogRef` and an
  `onClose` prop.)
- **`LabelModal.tsx`**, **`ConflictDialog.tsx`**, **`NoteConflictDialog.tsx`**,
  **`RemoveLabelDialog.tsx`**: add `useBackdropClose(dialogRef)`; the existing
  `onClose`/`onDismiss`/`onCancel` wired to the dialog's `close` event does the
  rest. Update the `LabelModal` lead comment to include backdrop dismissal.

## Tests

The three wiring variants are covered through representative components (mirroring
how `usePickerDialog` is tested through its consumers rather than directly — so no
standalone hook test is added):

1. **`src/components/SelectField.test.tsx`** (update) — the picker variant
   (`useBackdropClose` via `usePickerDialog`, default path). Open the field, then
   `fireEvent.click` the `dialog.select-modal` element itself (target = dialog) and
   assert it closes; add a negative case that clicking an inner option/title does
   **not** close via the backdrop path (the option click already closes by
   choosing, so assert with the Cancel/title region — e.g. clicking the
   `select-modal-title` leaves it open). This exercises SortField/OptionsModal too
   (same hook), so they need no separate backdrop test.
2. **`src/components/RemoveLabelDialog.test.tsx`** (update) — the default
   native-close variant. Open it, click the dialog element (backdrop), assert
   `onCancel` fires (same as Escape/Cancel), proving `dialog.close()` -> native
   `close` -> `onCancel`.
3. **`src/components/SettingsModal.test.tsx`** (update) — the state-driven override
   variant. Open it, click the dialog element, assert the `onClose` prop fires
   (not a direct element close), proving the override path keeps parent state in
   charge.

All existing dialog tests stay green: a backdrop listener that only acts when
`e.target === dialog` never fires on the button/option clicks those tests perform.

## Verification

- `npm test` — existing suites pass; three updated suites cover the new behaviour.
- `npm run build` (tsc + vite) — type-checks the new hook (its `RefObject<
  HTMLDialogElement | null>` signature matches every `useRef<HTMLDialogElement>(null)`
  call site) and bundles.
- Manual: open each modal (Settings, Edit task, Add label, a Select/Sort/Options
  picker, a conflict dialog) and click the dark area outside the box — it closes
  with the same result as Escape (non-destructive where Escape was, e.g. conflict
  dialogs leave both copies). Clicking inside the box (fields, buttons, list) does
  not close it. A picker opened inside Settings/Options closes only the picker on
  its own backdrop click, not the dialog beneath it.

## Out of scope

- **No `<Modal>` wrapper / body refactor** — rejected by task 18's review;
  backdrop close is a behaviour hook, not shared markup.
- **No geometry-based "outside" test** — `e.target === dialog` is the canonical,
  testable check; the dialog's own thin padding ring counting as outside is an
  accepted, standard trade-off (clicking dead space at the very edge of the box
  dismisses, as in most implementations).
- **No drag-select hardening** — a text selection in a conflict preview that
  starts inside and releases on the backdrop is a rare edge; Escape and the buttons
  remain. Not worth a mousedown/mouseup tracking layer here.
- **No change to dismiss semantics** — backdrop does exactly what Escape already
  did for each dialog (e.g. conflict dialogs stay non-destructive).
