# 14 - Replace every dropdown with a modal picker

## Goal

Replace every native `<select>` in the app with a tap-to-open **modal picker**:
a trigger button that shows the current selection and, when pressed, opens a
native `<dialog>` listing the options as a vertical list of buttons. Choosing a
row selects that value and closes the dialog. For the **Project** and **Context**
label pickers, each concrete label row carries a **Remove** button on its right;
pressing it runs task 12's confirm-then-untag removal. This supersedes task 13's
"Remove option inside the dropdown" — with the dropdown now a modal list, removal
moves onto each label *item*, which is where the user asked for it.

Nine selects are converted:

| Where | Selects |
|---|---|
| `FilterBar` | Status, Project, Context, Sort |
| `AddForm` | Priority, Project, Context (the latter two via `LabelSelect`) |
| `EditTaskModal` | Priority, Project, Context (via `LabelSelect`) |
| `SettingsModal` | On-conflict strategy |

## Design principle — one deep picker component, used everywhere

The conceptual integrity rule here is "every chooser looks and behaves the same."
A single reusable component owns the whole picker behaviour so no caller
re-implements open/close, option rendering, or keyboard/backdrop dismissal:

### `components/SelectField.tsx` (new)

A drop-in replacement for a labelled `<select>`. It renders the **trigger button**
and owns the **picker `<dialog>`** and its open state.

```ts
export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right
}

interface Props {
  ariaLabel: string;                 // accessible name for trigger + dialog
  value: string;                     // currently selected option value
  options: FieldOption[];
  onChange(value: string): void;     // a row was chosen
  onRemove?(value: string): void;    // a removable row's Remove was pressed
}
```

Behaviour:
- **Trigger:** a `<button type="button" aria-label={ariaLabel}>` showing the
  label of the option whose `value === value` (falling back to the first
  option's label if none matches). `aria-haspopup="dialog"`. Opening sets local
  `open` state.
- **Dialog:** a native `<dialog>` (same `showModal()`/`close()` `useEffect`
  pattern as `LabelModal`/`EditTaskModal`, driven by the local `open` boolean).
  `onClose` resets `open` so Escape/backdrop close stays in sync. A heading shows
  `ariaLabel`. The body is a `.picker-list` of rows.
- **Row:** a `.picker-option` containing a main `<button type="button">` with the
  option label (click → `onChange(value)` then close) and, when
  `option.removable && onRemove`, a trailing `.picker-remove`
  `<button aria-label={`Remove ${label}`}>` (click → close, then
  `onRemove(value)`; closing first so a confirm dialog opened by the parent is
  not stacked under this picker). The currently-selected row gets
  `aria-current="true"` for a check/highlight.
- No portal, no focus library: native `<dialog>` already gives the focus trap,
  backdrop, and Escape handling the rest of the app relies on.

Why a component and not a hook or raw markup in each caller: nine call sites with
identical open/close/list logic would be nine copies of the same decision (R3),
and a chooser that behaves differently per screen is exactly the conceptual-
integrity erosion Brooks warns about. One deep module hides all of it behind
four props.

### Sentinels stay in the caller, not the picker

`LabelSelect`'s "+ Add ..." entry keeps working exactly as today: it is just a
`FieldOption` whose `value` is `ADD_VALUE`, and `LabelSelect`'s existing
`onChange` interceptor turns that selection into `onAdd()`. The picker needs no
"action option" concept — selecting `ADD_VALUE` flows through `onChange` and the
caller decides. This keeps `SelectField` ignorant of label semantics (it only
knows value/label/removable), an Interface Segregation fit.

Task 13's `REMOVE_VALUE` sentinel is **deleted** from `config.ts`: removal is no
longer an option-as-action; it is a per-row button surfaced via `onRemove`. Its
collision-safety reasoning is no longer needed.

## Where each concern lives

| Concern | Home | Change |
|---|---|---|
| Generic trigger + modal list + per-row remove | `components/SelectField.tsx` | New |
| Status / Sort pickers | `components/FilterBar.tsx` | Replace 2 `<select>` with `SelectField` |
| Project / Context filter pickers + remove | `components/FilterBar.tsx` | Replace 2 `<select>` with `SelectField`; mark name rows `removable`, wire `onRemove`; drop the `REMOVE_VALUE` branch |
| Priority picker | `AddForm.tsx`, `EditTaskModal.tsx` | Replace `<select>` with `SelectField` |
| Project / Context form pickers (+ "Add") | `components/LabelSelect.tsx` | Replace `<select>` with `SelectField`; keep `ADD_VALUE` interception; **no** per-row remove (removal is a store-level filter action, per task 12) |
| Conflict-strategy picker | `components/SettingsModal.tsx` | Replace `<select>` with `SelectField` |
| `REMOVE_VALUE` sentinel | `config.ts` | Delete (task 13) |
| Removal mechanics / confirm dialog | `labels.ts`, `TodoPane.tsx`, `RemoveLabelDialog.tsx` | Unchanged — `onRemove(kind, name)` contract preserved |
| Styles | `style.css` | New `.select-field` trigger, `.picker-list`, `.picker-option`, `.picker-remove`; the picker dialog reuses the shared dialog/backdrop shape |

## Why removal stays out of the form label pickers

Task 12 deliberately put removal at the **filter / store** level, not in the
add/edit forms ("removal acts on the whole store and is a TodoPane-level
action"). The form `LabelSelect` is for *assigning* a label to the task being
written; a Remove button there would mix "untag every task" into a single-task
edit. So only the two `FilterBar` label pickers pass `onRemove`; the form
pickers render the same component without it (no removable rows). This keeps the
"right side of each project/context item" affordance where the user removes
labels today.

## Implementation

1. **`src/config.ts`** — delete `REMOVE_VALUE` and its comment block.

2. **`src/components/SelectField.tsx`** — new, as specified above. Native
   `<dialog>` with a `ref` and a `useEffect` mirroring `LabelModal`:
   `open ? showModal() : close()`; `onClose={() => setOpen(false)}`. Give the
   dialog a stable `className="select-modal"` (not an id — there are many
   instances) so CSS targets the class.

3. **`src/components/FilterBar.tsx`** — build `FieldOption[]` arrays:
   - Status: `Object.entries(STATUSES).map(([value, s]) => ({ value, label: s.label }))`.
   - Sort: `Object.entries(SORTS).map(([value, s]) => ({ value, label: s.label }))`.
   - Project: `[{ value: "", label: \`All ${KINDS.project.singular}s\` },
     ...sorted names.map((n) => ({ value: n, label: n, removable: true }))]`;
     `onChange={onProject}`, `onRemove={(name) => onRemove("project", name)}`.
   - Context: the `@`/context twin.
   Drop the `REMOVE_VALUE` import and the in-`onChange` remove branch from task 13.

4. **`src/components/LabelSelect.tsx`** — keep the options merge and the
   `ADD_VALUE` interception; render `SelectField` instead of `<select>`:
   `options = [{ value: ADD_VALUE, label: \`+ Add ${label}...\` },
   { value: "", label: EMPTY_LABEL }, ...names.map((n) => ({ value: n, label: n }))]`.
   `onChange={handleChange}` (unchanged interceptor). No `onRemove`.

5. **`src/components/AddForm.tsx`** / **`EditTaskModal.tsx`** — replace the
   Priority `<select>` with `SelectField` whose options are the shared
   `PRIORITY_OPTIONS` (see below) and `onChange={setPriority}`. The `LabelSelect`
   usages already become pickers via step 4 — no change there.

   To avoid building the same Priority list in two forms (DRY), define it once in
   `config.ts` beside `PRIORITIES` and import it in both:
   ```ts
   export const PRIORITY_OPTIONS = [
     { value: "", label: EMPTY_LABEL },
     ...PRIORITIES.map((p) => ({ value: p, label: p })),
   ];
   ```
   `EMPTY_LABEL` already lives in `config.ts`, so the option list has one home.
   The Status/Sort/strategy lists each have a single call site and stay inline.

6. **`src/components/SettingsModal.tsx`** — replace the strategy `<select>` with
   `SelectField` (options: the three strategy value/label pairs;
   `onChange` casts to `ConflictStrategy` and calls `setStrategy`/`setConflictStrategy`
   as today). A picker dialog opening over the settings dialog stacks on the
   native top layer, exactly as `LabelModal` already opens over `EditTaskModal`.

7. **`src/style.css`** — add:
   - `.select-field` — the trigger button styled like the old select box (reuse
     the `#filters select` / `.add-fields select` border/padding/radius so the
     row layout is unchanged), with a small ▾ affordance.
   - `dialog.select-modal` — reuse the `#label-modal` border/radius/padding and a
     `::backdrop`. Generalise by adding `.select-modal` to the existing shared
     dialog rule rather than duplicating it.
   - `.picker-list` (column flex), `.picker-option` (row: main button flex-1 +
     remove button), `.picker-remove` (danger-tinted small button),
     `[aria-current="true"]` highlight.

## Tests

- **`src/components/SelectField.test.tsx`** (new, jsdom + Testing Library, shared
  `<dialog>` polyfill via `src/test/setup.ts`):
  - trigger shows the current value's label;
  - the dialog is closed until the trigger is clicked, then lists every option;
  - clicking an option calls `onChange` with its value and closes the dialog;
  - with `onRemove` set, a `removable` option shows a Remove button that calls
    `onRemove(value)`; a non-removable option shows none;
  - without `onRemove`, even a `removable` option shows no Remove button.

- **`src/components/FilterBar.test.tsx`** — rewrite for the new interaction: open
  the Project picker, assert it lists the labels, choosing one calls `onProject`,
  and a label row's Remove calls `onRemove("project", name)`; the "All ..." row
  has no Remove. Drop the `REMOVE_VALUE` / `combobox` assertions.

- **`src/components/AddForm.test.tsx`** / **`EditTaskModal.test.tsx`** — replace
  `selectOptions`/`combobox` interactions: open the relevant picker and click the
  desired row (Priority, Project, Context). The `+ Add ...` row still opens
  `LabelModal`. Behavioural assertions (composed text, staging) are unchanged.

- **`src/components/TodoPane.test.tsx`** — the removal-glue tests now open the
  Project filter picker and click a label row's **Remove** button (instead of the
  task-13 `REMOVE_VALUE` change event); the asserted glue (which tasks update, the
  reload, the error path) is unchanged.

- `labels.test.ts`, `RemoveLabelDialog.test.tsx`, and the other suites are
  untouched.

## Migration must land atomically

This touches ~12 files (six components, `config.ts`, `style.css`, and five test
files). Every site is a dropdown, so the breadth is one-time migration cost, not
tangled responsibilities — and afterwards chooser changes localize to
`SelectField`. The migration must land in a single change: no screen should be
left on a native `<select>` while others use the picker, so the two chooser
idioms never coexist. After this lands, the only `<select>` left in `src/` should
be zero.

## Out of scope

- **No change to removal mechanics.** `removeLabel` / `planLabelRemoval` /
  `confirmRemove` / `RemoveLabelDialog` and the `listTasks`/`updateTask`/`refresh`/
  `loadLabels` glue are unchanged; only the trigger surface moves.
- **No backend / HTTP change.** `src-tauri/` and the server are untouched.
- **No multi-select.** Each picker remains single-choice, matching the `<select>`
  it replaces.
- **No removal in the add/edit form label pickers** (see rationale above).
- **No new dependency.** Native `<dialog>` only, consistent with the existing
  modals.

## Verification

- `npm test` — existing suites pass after the interaction rewrites; new
  `SelectField` tests pass.
- `npm run build` (tsc + vite) — type-checks the new component and the deleted
  `REMOVE_VALUE`.
- Manual, local mode: every former dropdown (Status, Sort, Priority, Project,
  Context, On-conflict) opens a modal list; choosing a row updates the value and
  closes; Escape/backdrop cancels. In the Project/Context filter pickers each
  label row shows a Remove on its right that opens the confirm dialog and, on
  confirm, untags every task and drops the label from all pickers. The `+ Add`
  row in the add/edit pickers still opens the label modal. Settings' On-conflict
  picker opens over the settings dialog.
