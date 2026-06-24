# 14 - Review fixes — implemented

Applies `review-plan.md` (both 🟢 suggestions from `code-review.md`, 98/100).

## Changes

- **`src/components/SelectField.tsx`** — added `aria-label={ariaLabel}` to the
  picker `<dialog>`, so the modal's accessible name matches its visible title.
  No behavior change.
- **`src/components/SelectField.test.tsx`** — assert the open dialog is reachable
  as `getByRole("dialog", { name: /project filter/i })`.
- **`src/components/SettingsModal.test.tsx`** (new) — render with `open`, open the
  "On conflict" picker, choose "Always use server", and assert
  `setConflictStrategy("server")` was called and the trigger now shows the chosen
  label. Mocks `../api` and `../settings`.

## Verification

- `npm test` — 115 passed (17 files).
- `npm run build` (tsc + vite) — type-checks and builds clean.
