# 17 - Review implemented

Applied the one actionable finding from `code-review.md` (98/100) per
`review-plan.md` (brooks-review 100/100).

## Finding 1 — `optionLabel` duplication → fixed

- `src/components/PickerList.tsx` — added an exported `optionLabel(options, value)`
  helper (matching option's label, else first option's, else `""`).
- `src/components/SelectField.tsx` — removed the local `selected` derivation; the
  trigger now renders `{optionLabel(options, value)}`.
- `src/components/SortField.tsx` — removed the local `labelFor`; the trigger
  summary is now `` `${optionLabel(sortOptions, sort)} · ${optionLabel(dirOptions, dir)}` ``.
- `src/components/PickerList.test.tsx` — added three `optionLabel` unit tests
  (match / fallback-to-first / empty-options → "").

Behaviour is identical, so `SelectField.test.tsx`, `SortField.test.tsx`, and
`FilterBar.test.tsx` stayed green with no edits.

## Finding 2 — picker-shell duplication → kept (documented)

No change. A shared shell would couple `SelectField`'s close-on-pick/single-value
behaviour and `SortField`'s stay-open/`sort · dir`/Done behaviour into a shallow,
flag-driven module; the open/close `useEffect` is already duplicated by the
codebase's established `LabelModal`/`EditTaskModal`/`SelectField` convention.
Rationale in full in `review-plan.md`.

## Verification

- `npm run build` — type-checks and bundles (ntr@0.6.0).
- `npm test` — 19 files, 136 tests pass (was 133; +3 `optionLabel`).
