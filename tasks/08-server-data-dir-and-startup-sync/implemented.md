# 08 - Implemented

## Changes

### `src/api.ts`

Added `syncFromServer()` (exported): fetches the current note and all tasks
from the server and writes them to the local files via `invoke("put_note")`
and `invoke("put_raw")`. Two independent try/catch blocks so a note failure
does not cancel the task sync. No-op when no server URL is set.

### `src/App.tsx`

Added a `useEffect([connectionKey])` that calls `syncFromServer()`. Fires on
mount (initial open) and after every settings close (server URL may change).
When disconnecting, `syncFromServer` returns immediately.

### `src/components/SettingsModal.tsx`

- Removed the `isLocal` variable and its guard `{isLocal && (...)}` around the
  data-directory section. The section now always renders.
- `getDataDir()` is now called unconditionally when the dialog opens (was only
  called in local mode).
- Updated hint text to say "stored locally" for clarity in server mode.

### `src/api.test.ts`

- Promoted `mkRes` and `makeFetchSeq` to module level (were duplicated inside
  the local-backup describe block and inline in syncFromServer tests).
- Added `describe("syncFromServer")` with 4 tests:
  - No-op in local mode.
  - Syncs note via `invoke("put_note")`.
  - Syncs all tasks via `invoke("put_raw")`.
  - Task sync proceeds even when note fetch returns 404.

## Test results

- `npx vitest run` — 65 tests pass (9 test files).
- `npm run build` — TypeScript clean, Vite bundles.
- No Rust changes.
