# 03 - Review implementation notes

Applied the one Suggestion from the 99/100 code review.

## Change

Moved `PRIORITIES = ["A", "B", "C"]` from `AddForm.tsx` and `EditTaskModal.tsx` to
`config.ts` (as `const` tuple, alongside `STATUSES`, `SORTS`, `KINDS`). Both components
now import it from `../config`.

## Verification

- `npx vitest run` → 51 passed (unchanged).
- `npm run build` → clean.
