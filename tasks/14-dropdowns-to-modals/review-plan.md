# 14 - Plan to implement the code review

## Findings to address (from code-review.md, brooks-review 98/100)

Two 🟢 Suggestions, no Critical/Warning. Both are small and low-risk.

### 1. Picker dialog has no accessible name (R1 / a11y)

**Fix:** add `aria-label={ariaLabel}` to the `<dialog>` element in
`SelectField.tsx`. The visible `<h2>` already shows the same text; this makes the
modal's accessible name match it. No behavior change, no new prop.

**Test:** in `SelectField.test.tsx`, assert the open dialog is reachable as a
`dialog` role with the field's name — e.g.
`screen.getByRole("dialog", { name: /project filter/i })`.

### 2. Settings conflict-strategy picker has no test (Coverage Illusion)

**Fix:** none to production code — the generic `SelectField` behavior is already
covered; this only adds a focused wiring test.

**Test:** new `src/components/SettingsModal.test.tsx` (mock `../api` and
`../settings`, like `EditTaskModal.test.tsx` mocks `../api`): render with
`open`, open the "On conflict" picker, click a strategy row, and assert
`setConflictStrategy` was called with that value and the trigger now shows the
chosen label. Keep it to the one new behavior so it does not duplicate
`SelectField.test.tsx`.

## Why nothing larger

Both findings are boundary polish on an already-tested deep component. No
mechanism, prop, or structural change — so no second brooks-review iteration is
expected to be needed beyond confirming the plan scores > 95.

## Verification

- `npm test` — all suites green, including the new dialog-name assertion and the
  SettingsModal test.
- `npm run build` — type-checks.
