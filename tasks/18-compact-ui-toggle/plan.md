# 18 - Compact UI toggle (collapse the control rows into "Options" modals)

## Goal

Add a **setting** that switches the todo view between its current layout and a
**compact** one. The setting lives in the existing Settings modal as a checkbox;
it defaults **off** (current layout). The task list itself is untouched in both
modes — only the two control rows change.

```
Current (default)                         Compact
-----------------                         -------
<Input> <Add>                             <Input> <Add> <Options ▸ Priority/Due/Projects/Contexts>
<Priority> <Due> <Projects> <Contexts>    <Options ▸ Status/Project/Context/Sort>
<Status> <Project> <Context> <Sort>       <List>
<List>
```

So in compact mode:

- The add form's four field controls (Priority / Due / Projects / Contexts) move
  off their own row into **one "Options" button on the add row**, opening a modal
  that holds those four controls.
- The filter row's four choosers (Status / Project / Context / Sort) collapse into
  **one "Options" button**, opening a modal that holds those four.

Both "Options" buttons open the *same kind* of thing: a modal that wraps a group
of already-existing field controls. That is one new concept — capture it once.

## Design — one new component, one new setting, no logic moved

### The shared dialog driver: `usePickerDialog` (resolve the now-three-way shell duplication)

`OptionsModal` would be the **third** self-opening picker shell (after
`SelectField` and `SortField`) to copy the same block: a `dialogRef`, an `open`
`useState`, and the `useEffect` that calls `showModal()` / `close()` in step with
`open`. Task 17's review deliberately deferred extracting this "only if a third
picker variant appears". This task *is* that third variant, so the block is lifted
**now** into one hook — `src/lib/usePickerDialog.ts`:

```tsx
import { useEffect, useRef, useState } from "react";

// Self-owned open state for a native <dialog> opened as a modal: returns the ref to attach, the
// current `open` flag, and its setter, keeping the element in step with `open` (showModal/close).
// One home for the self-triggering pickers — SelectField, SortField, OptionsModal — each a trigger
// button plus a modal it opens itself. (LabelModal/EditTaskModal/SettingsModal differ: their open
// state arrives as a prop, so they are not callers.)
export function usePickerDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);
  return { dialogRef, open, setOpen };
}
```

`SelectField` and `SortField` are refactored to `const { dialogRef, open, setOpen }
= usePickerDialog();` (deleting their inline ref/state/effect); their behaviour and
their tests are unchanged — the hook is the same code, relocated. With three real
callers this is justified DRY, not premature abstraction.

### The shared piece: `OptionsModal`

Both collapses are "take this set of `<label><control/></label>` blocks and, when
compact, show them behind one Options button instead of inline". That wrapper is
the single new idea, so it gets one home: **`src/components/OptionsModal.tsx`** —
a trigger button labelled "Options" plus a `<dialog>` that renders whatever
controls it is given and a Done button to close. It is presentation only; it owns
no field state and knows nothing about priorities or filters (the controls passed
to it stay fully controlled by `AddForm` / `FilterBar`, exactly as today).

It mirrors the established picker shell (`SelectField` / `SortField`): same
open-state `useEffect`, same `aria-haspopup="dialog"`, same `.modal-actions` Done
button. It uses its **own** dialog class `options-modal` (not `select-modal`) so
the existing `dialog.select-modal[open]` test/queries stay unambiguous when a
`SelectField` inside it opens its own nested modal.

```tsx
// A control group collapsed behind one "Options" button: the trigger plus a <dialog> that renders
// whatever field controls it is handed, with a Done button to close. Used by compact mode to fold
// the add-form fields and the filter choosers each behind a single button. Presentation only — the
// controls passed in stay controlled by their owner (AddForm / FilterBar); this just hides them
// behind a modal. Same dialog shell as SelectField/SortField, with its own `options-modal` class so
// a SelectField opening its own `select-modal` inside it never collides with that selector.

import { type ReactNode } from "react";
import { usePickerDialog } from "../lib/usePickerDialog";

interface Props {
  ariaLabel: string; // accessible name for the trigger and dialog (e.g. "Task options")
  children: ReactNode; // the field controls to show inside the modal
}

export default function OptionsModal({ ariaLabel, children }: Props) {
  const { dialogRef, open, setOpen } = usePickerDialog();

  return (
    <>
      <button
        type="button"
        className="options-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Options
      </button>
      {/* Contents only while open, so a closed dialog leaves no stray focusable triggers in the DOM. */}
      <dialog className="options-modal" aria-label={ariaLabel} ref={dialogRef} onClose={() => setOpen(false)}>
        {open && (
          <>
            <h2 className="select-modal-title">{ariaLabel}</h2>
            <div className="options-fields">{children}</div>
            <div className="modal-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
```

### The setting: `getCompactUi` / `setCompactUi`

Add to **`src/settings.ts`** beside the other booleans, following the exact
`getAllowInvalidCert` shape (a value that only exists when explicitly on, so the
default is "absent key" = off):

```ts
const COMPACT_UI_KEY = "ntr.compactUi";

// Whether the todo controls render in the compact, modal-collapsed layout. Off by default
// (absent key); persisted like setAllowInvalidCert — "1" only when explicitly enabled.
export function getCompactUi(): boolean {
  return localStorage.getItem(COMPACT_UI_KEY) === "1";
}

export function setCompactUi(on: boolean): void {
  on ? localStorage.setItem(COMPACT_UI_KEY, "1") : localStorage.removeItem(COMPACT_UI_KEY);
}
```

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| Self-opened `<dialog>` open/close driver | **new `usePickerDialog`** (`src/lib/usePickerDialog.ts`) | Add; adopted by SelectField, SortField, OptionsModal |
| Collapse a control group behind one Options button | **new `OptionsModal`** (`src/components/OptionsModal.tsx`) | Add |
| Compact setting (read/write) | `src/settings.ts` | Add `get/setCompactUi` |
| Compact toggle UI | `src/components/SettingsModal.tsx` | Add a "Display" checkbox |
| Compact state + propagation | `src/App.tsx` | Own `compact`, pass to `TodoPane` |
| Pass compact down to the rows | `src/components/TodoPane.tsx` | Accept `compact`, forward to AddForm + FilterBar |
| Add-form layout (inline vs Options) | `src/components/AddForm.tsx` | Branch on `compact` |
| Filter-row layout (inline vs Options) | `src/components/FilterBar.tsx` | Branch on `compact` |
| Styling for the modal field group | `src/style.css` | Add `.options-fields` / `.options-trigger`, extend label selectors |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.6.0 -> 0.7.0 (done) |

No backend (`src-tauri/`) or `api.ts` change. **No sorting/filtering/label logic
moves** — only where the same controls are rendered.

## Propagation — `compact` is drilled, applied on settings close

`compact` is a render-time prop, owned by `App` and threaded down to the two rows.
It is **not** read from `localStorage` inside the leaf components (that would not
re-render on change). The flow mirrors how every other setting already applies —
on settings close, not live — which is correct here because the Settings modal
covers the screen, so a "live" toggle behind it would be invisible anyway:

- `App`: `const [compact, setCompact] = useState(getCompactUi);` and, in the
  existing `onSettingsClose`, add `setCompact(getCompactUi());` (right where it
  already re-reads connection state and refreshes the panes). Pass
  `compact={compact}` to `<TodoPane>`.
- `SettingsModal`: a checkbox that calls `setCompactUi(checked)` on change (and
  mirrors it into local checkbox state), exactly like the `allowInvalidCert`
  checkbox. No new callback prop — `App` re-reads on close.
- `TodoPane`: gains a `compact: boolean` prop and forwards it to `<AddForm>` and
  `<FilterBar>`. Its filter/sort/label state and `sortTasks` call are unchanged.
- `AddForm` / `FilterBar`: gain a `compact: boolean` prop (required, so the path
  is explicit end-to-end — no hidden default) and branch their layout on it.

## `AddForm` (`src/components/AddForm.tsx`)

The four field `<label>` blocks are defined **once** as a `fields` fragment, then
placed either inline (default) or inside `OptionsModal` (compact) — so the
controls themselves, their props, and their wiring exist in exactly one place:

```tsx
const fields = (
  <>
    <label>Priority <SelectField .../></label>
    <label>Due <input type="date" .../></label>
    <label>Projects <LabelSelect .../></label>
    <label>Contexts <LabelSelect .../></label>
  </>
);
// ...
<form id="add-form" ...>
  <div className="add-row">
    <input id="add-input" .../>
    <button type="submit">Add</button>
    {compact && <OptionsModal ariaLabel="Task options">{fields}</OptionsModal>}
  </div>
  {!compact && <div className="add-fields">{fields}</div>}
</form>
```

`fields` is rendered in exactly one branch at a time, so there is no duplicate
mount and no key juggling. `LabelModal` stays the form's sibling exactly as now
(the nested-submit fix is untouched).

## `FilterBar` (`src/components/FilterBar.tsx`)

Same shape: the four chooser `<label>` blocks become a `fields` fragment, rendered
inline inside `#filters` (default) or inside one `OptionsModal` (compact). `Props`
gains `compact`. The Sort chooser stays the task-17 `SortField`.

```tsx
return (
  <div id="filters">
    {compact ? <OptionsModal ariaLabel="Filter options">{fields}</OptionsModal> : fields}
  </div>
);
```

The `onRemove` label flow inside the Project/Context pickers is unchanged; it just
opens from a `SelectField` that now happens to live inside the Options modal.

## `SettingsModal` (`src/components/SettingsModal.tsx`)

Add a small section after the existing ones, built exactly like the
`allowInvalidCert` checkbox row (so it needs no new CSS — it reuses
`.settings-checkbox` + `.settings-hint`):

```tsx
<h2>Display</h2>
<label className="settings-checkbox">
  <input
    type="checkbox"
    checked={compact}
    onChange={(e) => {
      setCompactState(e.target.checked);
      setCompactUi(e.target.checked);
    }}
  />
  Compact controls
</label>
<p className="settings-hint">
  Collapse the task fields and filters into "Options" buttons.
</p>
```

`compact` checkbox state is seeded from `getCompactUi()` in the same `open` effect
that seeds the other fields.

## CSS (`src/style.css`)

The field `<label>`s are styled by descendant selectors tied to `.add-fields` /
`#filters`. Inside `OptionsModal` they need the same look, so extend those
selectors and add a vertical container:

```css
/* Compact "Options" modal: stack the borrowed field rows; reuse the field-label and date-input
   styling so a control looks the same inline or inside the modal. */
.options-fields {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}
.options-trigger {
  align-self: center; /* sit beside Add on the add row */
}
```

and add `.options-fields label` to the existing
`.add-fields label, #filters label { ... }` rule and
`.options-fields input[type="date"]` to the
`.select-field, .add-fields input[type="date"] { ... }` rule, so no field styling
is duplicated — the modal just opts the same controls into the same rules.

## Tests

1. **`src/components/OptionsModal.test.tsx`** (new) — the wrapper in isolation:
   the trigger shows "Options" with the given accessible name; the dialog is
   closed until clicked; once open it renders the passed children (a probe child)
   and a Done button; Done closes it. Follows the SortField dialog-interaction
   pattern (jsdom `showModal` polyfill in `src/test/setup.ts`). This also exercises
   `usePickerDialog`; `SelectField.test.tsx` and `SortField.test.tsx` already cover
   it from the other two callers, so no separate hook test is added (it has no
   behaviour beyond what those component tests assert).

2. **`src/components/AddForm.test.tsx`** (update) — the existing three cases render
   in default mode; add `compact={false}` to those renders (explicit). Add a
   compact case: with `compact`, the four fields are **not** inline; clicking the
   "Task options" button opens a dialog containing the Priority / Due / Projects /
   Contexts controls; the add row still has the New task input and Add button.

3. **`src/components/FilterBar.test.tsx`** (update) — pass `compact={false}` in the
   existing `renderBar` helper (keeps every current case as-is). Add a compact
   case: with `compact`, the Status/Project/Context/Sort triggers are not inline;
   clicking "Filter options" opens a dialog exposing them, and choosing inside
   still fires the right callback (e.g. open Filter options → open the Sort picker
   → pick Projects → `onSort("projects")`), proving the controls still work nested.

4. **`src/components/TodoPane.test.tsx`** (update) — pass `compact={false}` to the
   two `<TodoPane />` renders so the required prop is satisfied; behaviour
   unchanged.

5. **`src/components/SettingsModal.test.tsx`** (update) — add a case: toggling the
   "Compact controls" checkbox calls through to persistence. Either assert
   `getCompactUi()` flips after the change (real localStorage in jsdom), matching
   how the file already tests settings. Keep the existing case intact.

6. **`src/settings.test.ts`** (update) — add `get/setCompactUi` round-trip:
   default false; set true -> stored "1" and reads true; set false -> key removed
   and reads false. Mirror the existing `allowInvalidCert` tests.

No `config.ts` / `api.ts` test changes — no logic there changed.

## Verification

- `npm test` — all suites pass (existing + updated + new OptionsModal).
- `npm run build` (tsc + vite) — type-checks the new prop threads (`compact` on
  TodoPane/AddForm/FilterBar), the `OptionsModal` `children` prop, and the new
  settings functions; bundles.
- Manual: default layout unchanged. Open Settings, tick "Compact controls", close:
  the add fields collapse to an "Options" button beside Add, and the filter row
  collapses to one "Options" button; each opens a modal with its controls, which
  still work (pick a priority, a due date, a label; change status/sort); the task
  list is unchanged. Untick and close: the inline layout returns. The choice
  survives a reload (localStorage).

## Out of scope

- **No change to the task list UI** (explicit in the request — "Leave todo list
  UI").
- **No change to sorting/filtering/label logic** — only where controls render.
- **No responsive auto-compact** — compact is the user's explicit setting, not a
  width breakpoint.
- **No backend / `api.ts` / `src-tauri` change** beyond the version bump.
- **No reflow of the Settings modal's other sections.**
