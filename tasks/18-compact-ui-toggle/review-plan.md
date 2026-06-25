# 18 - Plan to address the code review

The code review (`code-review.md`) scored **98/100** with two 🟢 Suggestions and
no Critical/Warning. This plan decides each.

## Finding 1 — `usePickerDialog` lives in `src/lib/` → **fix (move to `src/components/`)**

`src/lib/` holds framework-agnostic modules (`caret`, `conflict`, `noteSync` — no
React import). `usePickerDialog` is a React hook whose only callers are the three
picker components. Relocating it keeps `lib/` honest as the React-free layer and
colocates the hook with its consumers.

### Change

- Move `src/lib/usePickerDialog.ts` → `src/components/usePickerDialog.ts`
  (content unchanged).
- Update the three importers to `from "./usePickerDialog"`:
  `SelectField.tsx`, `SortField.tsx`, `OptionsModal.tsx` (each currently imports
  `from "../lib/usePickerDialog"`).
- Update the hook's doc comment reference if it names a path (it does not).

No behaviour change, so all existing tests stay green unedited (the three picker
test suites exercise the hook through their components).

## Finding 2 — dialog body chrome duplicated (SortField / OptionsModal) → **keep, documented**

No change. The two bodies share only `<dialog>` + a title `<h2>` + a Done
`.modal-actions` button; extracting a "modal body" wrapper would be a shallow
component (its whole job is slotting `children` between a title and a button), and
`SelectField`'s body diverges (Cancel, close-on-pick). The drift-prone pieces are
already single-homed — `PickerList` (the row, task 17) and `usePickerDialog` (the
open/close driver, this task). Stopping here is the deliberate boundary short of
over-abstraction.

## Actions

- Move the hook file; fix three imports.
- No change for Finding 2.

## Verification

- `npm run build` — type-checks and bundles (the moved import paths resolve).
- `npm test` — all suites pass unchanged (145 tests).
