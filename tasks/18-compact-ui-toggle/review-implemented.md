# 18 - Review implemented

Applied the one actionable finding from `code-review.md` (98/100) per
`review-plan.md` (brooks-review 100/100).

## Finding 1 — hook in `src/lib/` → fixed

- Moved `src/lib/usePickerDialog.ts` → `src/components/usePickerDialog.ts` (via
  `git mv`, content unchanged), so `src/lib/` stays the framework-agnostic layer
  and the hook sits beside its three picker callers.
- Updated the three imports from `../lib/usePickerDialog` to `./usePickerDialog`
  in `SelectField.tsx`, `SortField.tsx`, `OptionsModal.tsx`.

No behaviour change, so all existing tests stayed green with no edits.

## Finding 2 — dialog body chrome duplication → kept (documented)

No change. A shared "modal body" wrapper would be a shallow component (slotting
`children` between a title and a Done button), and `SelectField`'s body diverges
(Cancel, close-on-pick). The drift-prone pieces are already single-homed
(`PickerList`, `usePickerDialog`). Full rationale in `review-plan.md`.

## Verification

- `npm run build` — type-checks and bundles (ntr@0.7.0).
- `npm test` — 20 files, 145 tests pass.
