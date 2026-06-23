# 03 - Code review plan

brooks-review scored 99/100 (one Suggestion). One change in two files.

## Fix: move `PRIORITIES` to `config.ts`

`const PRIORITIES = ["A", "B", "C"]` is defined identically in `AddForm.tsx` and
`EditTaskModal.tsx`. Move it to `config.ts` alongside `STATUSES`, `SORTS`, and `KINDS`.

Changes:
- `src/config.ts`: add `export const PRIORITIES = ["A", "B", "C"] as const;`
- `src/components/AddForm.tsx`: remove local `const PRIORITIES`; import from `../config`
- `src/components/EditTaskModal.tsx`: same
