# 14 - Code review (brooks-review)

## Round 1 — 98/100

**Mode:** PR Review · **Scope:** `SelectField.tsx` (+test), `FilterBar.tsx`,
`LabelSelect.tsx`, `AddForm.tsx`, `EditTaskModal.tsx`, `SettingsModal.tsx`,
`config.ts`, `style.css` · **Trend:** 99 → 98 (−1)

Two 🟢 Suggestions, no Critical/Warning.

- **R1 / a11y — picker dialog has no accessible name.** The `<dialog>` shows a
  visible `<h2>` title but lacks `aria-label`/`aria-labelledby`. Remedy: add
  `aria-label={ariaLabel}` to the dialog. → Fixed.
- **Coverage Illusion — the Settings strategy picker has no test.** Pre-existing
  gap (SettingsModal had no test), generic picker behavior already covered.
  Remedy: add a focused SettingsModal wiring test. → Added.

### Strengths confirmed

- One deep `SelectField` enforces conceptual integrity across all nine choosers;
  `REMOVE_VALUE` retired cleanly.
- Options de-duplicated (`PRIORITY_OPTIONS`, `labelOptions`); no per-call-site
  knowledge duplication.
- Rendering dialog contents only while open keeps the DOM and the tests
  unambiguous (one open dialog at a time).
- `onRemove(kind, name)` contract and the task-12 removal glue untouched.

## Plan to implement the review

See `review-plan.md` (brooks-review on the plan: 100/100 — boundary polish only,
no mechanism change). Both fixes applied:

1. `aria-label={ariaLabel}` on `SelectField`'s `<dialog>`, with a
   `getByRole("dialog", { name })` assertion in `SelectField.test.tsx`.
2. New `SettingsModal.test.tsx` covering the conflict-strategy picker wiring.

## Verification

- `npm test` — 115 passed (17 files).
- `npm run build` — type-checks and builds clean.
