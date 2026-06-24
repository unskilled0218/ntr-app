# 14 - Replace every dropdown with a modal picker — implemented

Implements `plan.md` (plan-review round 1: 98/100). Version bumped 0.3.1 → 0.4.0
(notable UI feature; minor bump on the 0.x line) across `package.json`,
`src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.

## Changes

- **`src/components/SelectField.tsx`** (new) — the one deep picker used by every
  chooser: a trigger button showing the current selection that opens a native
  `<dialog>` listing options as a vertical list of buttons. Choosing a row calls
  `onChange(value)` and closes; with `onRemove`, a `removable` option shows a
  Remove button on its right (closing the picker first so a parent confirm dialog
  is not stacked under it). The dialog renders its contents only while open, so a
  closed picker leaves no stray focusable buttons in the DOM. Props:
  `ariaLabel`, `value`, `options: FieldOption[]`, `onChange`, optional `onRemove`.
- **`src/config.ts`** — deleted task 13's `REMOVE_VALUE` sentinel (removal is now
  a per-row button, not an option-as-action). Added `PRIORITY_OPTIONS` so the add
  form and edit modal share one Priority option list (DRY).
- **`src/components/FilterBar.tsx`** — Status, Sort, Project, Context now render
  `SelectField`. Project/Context options mark each concrete label `removable` and
  pass `onRemove={(name) => onRemove(kind, name)}`; the `REMOVE_VALUE` branch is
  gone. `onRemove(kind, name)` contract to `TodoPane` is unchanged.
- **`src/components/LabelSelect.tsx`** — renders `SelectField` instead of a
  `<select>`, keeping the `ADD_VALUE` interception (the "+ Add..." row opens the
  label modal). No `onRemove` — removal stays a store-level filter action
  (task 12).
- **`src/components/AddForm.tsx`** / **`EditTaskModal.tsx`** — Priority `<select>`
  → `SelectField` with the shared `PRIORITY_OPTIONS`.
- **`src/components/SettingsModal.tsx`** — On-conflict `<select>` → `SelectField`
  (`STRATEGY_OPTIONS`); the picker opens over the settings dialog on the native
  top layer, as `LabelModal` already opens over `EditTaskModal`.
- **`src/style.css`** — `.select-field` trigger (styled like the old select box,
  with a ▾), `dialog.select-modal` (shares the label-modal shape + backdrop), and
  `.picker-list` / `.picker-option` / `.picker-choice` / `.picker-remove` /
  `[aria-current]` for the option list and per-row Remove.

No `<select>` remains in `src/` (verified). No backend, HTTP, or removal-mechanics
change — `labels.ts`, `RemoveLabelDialog`, and `TodoPane`'s `confirmRemove` glue
are untouched.

## Tests

- **`src/components/SelectField.test.tsx`** (new) — trigger shows the selected
  label; closed until clicked then lists all options; choosing calls `onChange`
  and closes; `removable` + `onRemove` shows a per-row Remove that fires
  `onRemove` and closes; no Remove without `onRemove`.
- **`src/components/FilterBar.test.tsx`** — rewritten for the picker interaction:
  choosing a project row calls `onProject`; each label row's Remove calls
  `onRemove(kind, name)`; "All ..." has no Remove; Status/Sort offer no Remove.
- **`src/components/AddForm.test.tsx`** / **`EditTaskModal.test.tsx`** — open the
  picker and click rows (and the "+ Add..." row) instead of `selectOptions`;
  assert the trigger's shown label. Behavioural assertions unchanged.
- **`src/components/TodoPane.test.tsx`** — the removal-glue tests open the Project
  picker and click the "work" row's Remove (helper `openRemove`); asserted glue
  unchanged.

## Verification

- `npm test` — 114 passed (16 files).
- `npm run build` (tsc + vite) — type-checks and builds clean.
