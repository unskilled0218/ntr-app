# 18 - Implemented

Added a Settings toggle ("Compact controls") that collapses the add-form fields
and the filter choosers each behind a single "Options" modal button. Presentation
only — the task list and all sorting/filtering/label logic are unchanged.

## Files

### New

- **`src/lib/usePickerDialog.ts`** — the self-opened `<dialog>` open/close driver
  (ref + `open` state + the showModal/close `useEffect`), extracted from the
  pickers now that a third caller exists. Returns `{ dialogRef, open, setOpen }`.
- **`src/components/OptionsModal.tsx`** — a control group collapsed behind one
  "Options" button: trigger + `<dialog class="options-modal">` rendering arbitrary
  `children` + a Done button. Uses `usePickerDialog`. Presentation only; the
  controls passed in stay owned by their caller.
- **`src/components/OptionsModal.test.tsx`** — trigger shows "Options" with the
  given accessible name; closed until clicked; renders children + Done; Done closes.

### Changed

- **`src/components/SelectField.tsx`**, **`src/components/SortField.tsx`** —
  replaced their inline ref/`open`/`useEffect` with `usePickerDialog()`. No
  behaviour change; their tests stayed green unedited.
- **`src/settings.ts`** — added `getCompactUi` / `setCompactUi` (key
  `ntr.compactUi`, "1" only when on), mirroring `getAllowInvalidCert`.
- **`src/components/SettingsModal.tsx`** — added a "Display" section with a
  "Compact controls" checkbox, seeded from `getCompactUi()` and persisted via
  `setCompactUi` on change (same pattern as the allow-invalid-cert checkbox).
- **`src/App.tsx`** — owns `compact` state (`useState(getCompactUi)`), re-reads it
  in `onSettingsClose`, and passes `compact` to `<TodoPane>`.
- **`src/components/TodoPane.tsx`** — gained a required `compact` prop, forwarded
  to `AddForm` and `FilterBar`. Filter/sort/label state unchanged.
- **`src/components/AddForm.tsx`** — the four field `<label>`s defined once as a
  `fields` fragment, rendered inline (`.add-fields`, default) or inside
  `<OptionsModal ariaLabel="Task options">` on the add row (compact).
- **`src/components/FilterBar.tsx`** — the four chooser `<label>`s defined once as
  a `fields` fragment, rendered inline in `#filters` (default) or inside
  `<OptionsModal ariaLabel="Filter options">` (compact).
- **`src/style.css`** — added `.options-fields` / `.options-trigger`, extended the
  field-label and date-input selectors to cover `.options-fields`, and added
  `dialog.options-modal` to the shared modal border/backdrop rules.
- **Tests** — `AddForm.test.tsx` (+compact case, `compact={false}` on existing),
  `FilterBar.test.tsx` (+compact case, `compact={false}` in helper),
  `TodoPane.test.tsx` (`compact={false}`), `SettingsModal.test.tsx` (+toggle case,
  mock extended), `settings.test.ts` (+`getCompactUi`/`setCompactUi` round-trip).
- **Version** — `0.6.0` -> `0.7.0` (package.json, tauri.conf.json, Cargo.toml,
  Cargo.lock).

### Unchanged (deliberately)

- The task list UI (explicit in the request) and all of `config.ts` / `api.ts` /
  `src-tauri`.

## Verification

- `npm run build` — type-checks and bundles (ntr@0.7.0).
- `npm test` — 20 files, 145 tests pass (was 133).
