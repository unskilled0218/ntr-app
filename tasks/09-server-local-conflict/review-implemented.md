# Review fixes implemented — 09 server/local conflict

Implements `review-plan.md` (brooks-reviewed at 100/100).

## Changes

- **`src/api.ts`** — `backupTasksLocally` now reads the server task file via
  `httpText("/api/raw")` and writes it through `put_raw`, dropping the
  `tasks.map(t => t.raw).join(...)` + trailing-newline logic. The server's
  `raw()` render is now the single source for "server tasks as text", shared by
  the backup and reconcile paths. (Resolves the round-1 Warning.)
- **`src/components/ConflictDialog.tsx`** — heading changed to
  `{label} out of sync with the server` (correct for both "Note" and "Tasks").
  (Resolves the round-1 Suggestion.)

## Test changes

- `src/api.test.ts` "server mode — local backup": the task backup's second fetch
  is now `GET /api/raw` returning raw text; fixtures changed from `[[TASK]]` to
  `[TASK.raw + "\n"]`, the URL assertion to `/api/raw`, and the empty case to a
  `[""]` body. `put_raw` assertions unchanged.
- `src/components/ConflictDialog.test.tsx`: heading assertions updated.

## Verification

- `npx vitest run` → 83 passed (11 files).
- `npm run build` → tsc clean, Vite bundles.
- `cargo test` → unchanged (no Rust changes).
