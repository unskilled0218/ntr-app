# 17 - Implemented

Merged the filter row's Sort and Direction choosers into one "Sort" trigger that
opens a single modal holding both. Presentation only — sort keys, direction
semantics, `sortTasks`, and `TodoPane`'s state are unchanged.

## Files

### New

- **`src/components/PickerList.tsx`** — the option-row body lifted out of
  `SelectField` (the `<ul class="picker-list">` of `.picker-choice` buttons, the
  `aria-current` highlight, the optional Remove button). Now the single home for
  "what a picker row is", shared by `SelectField` and `SortField`. Owns the
  `FieldOption` type.
- **`src/components/SortField.tsx`** — the combined picker. One `.select-field`
  trigger (`aria-label="Sort"`) showing the current `sort · dir` summary (e.g.
  "Priority · DESC"), opening one `<dialog class="select-modal">` with two
  `PickerList` groups (Sort keys, then Direction). Choosing a row applies live
  (`onSort`/`onDir`) and does **not** close — both can be set in one visit; a
  single **Done** button closes. Uses the same open/close `useEffect` convention
  as `SelectField`/`LabelModal`/`EditTaskModal`.
- **`src/components/PickerList.test.tsx`** — the row contract: one button per
  option, `aria-current` on the selected row, `onChoose` with the value, Remove
  gated on both `removable` and `onRemove`.
- **`src/components/SortField.test.tsx`** — trigger name "Sort" + `sort · dir`
  summary; one dialog holds both groups; a sort pick fires `onSort` and leaves the
  dialog open so direction can also be set; Done closes; current rows marked.

### Changed

- **`src/components/SelectField.tsx`** — renders its list through `<PickerList>`
  instead of an inline `<ul>`; behaviour unchanged (still closes on pick).
  `FieldOption` now lives in `PickerList` and is re-exported here, so every
  existing `import { FieldOption } from "./SelectField"` is untouched.
- **`src/components/FilterBar.tsx`** — the two trailing `<SelectField>`s (Sort
  order + Sort direction) replaced by one `<SortField>` fed `SORT_OPTIONS` /
  `DIRECTION_OPTIONS`. `Props` unchanged (`sort`/`dir`/`onSort`/`onDir` all stay),
  so `TodoPane` needed no edit. Header comment updated.
- **`src/components/FilterBar.test.tsx`** — the two sort/direction cases folded
  into one: open the single "Sort" picker, assert it offers Projects/Contexts (no
  A-Z) **and** ASC/DESC, and that picking Projects then DESC fires both callbacks
  without the modal closing between them. Remove-absence case opens the picker by
  its new "Sort" name.
- **`src/style.css`** — added `.picker-group-title` for the two group headings.
- **Version** — `0.5.0` -> `0.6.0` in package.json, tauri.conf.json, Cargo.toml,
  Cargo.lock.

### Unchanged (deliberately)

- `src/config.ts` (sort keys, `DIRECTIONS`, `sortTasks`) and `src/config.test.ts`.
- `src/components/TodoPane.tsx` — still owns `sort`/`dir` and passes the same
  props to `FilterBar`.
- `SelectField.test.tsx` — stays green with no edits, the proof that routing the
  list through `PickerList` preserved single-select behaviour.

## Verification

- `npm run build` — type-checks and bundles (ntr@0.6.0).
- `npm test` — 19 files, 133 tests pass (was 124; +5 PickerList, +5 SortField,
  −1 from folding two FilterBar cases into one).
