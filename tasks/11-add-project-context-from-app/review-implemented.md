# Review fixes implemented — 11 add project/context from the app

Implements `review-plan.md` (brooks-reviewed at 100/100). Test-infrastructure
only; no production code or behavior change.

## Changes

- **`src/test/setup.ts`** (new) — single home for the jsdom `<dialog>`
  polyfill (`showModal`/`close`), run via vitest `setupFiles` before every suite.
- **`vitest.config.ts`** — added `setupFiles: ["./src/test/setup.ts"]`.
- **`src/components/AddForm.test.tsx`** and
  **`src/components/EditTaskModal.test.tsx`** — removed the per-file `beforeAll`
  dialog stub and the now-unused `beforeAll` import. (Resolves the round-1
  Knowledge Duplication suggestion.)

The id-based test scoping suggestion was consciously declined (see
`review-plan.md`).

## Verification

- `npx vitest run` — 12 files / 91 tests pass, including the two suites that lost
  their local stub, proving the shared setup patches the prototypes in time.
- `npm run build` — tsc clean (the new `src/test/setup.ts` type-checks), Vite
  bundles unchanged.
