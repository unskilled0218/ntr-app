# Brooks-Review — Code: 08 server data dir and startup sync

## Score: 98 / 100

No decay risks or design smells found. Implementation matches the reviewed plan
exactly. All 65 tests pass; TypeScript build is clean.

---

## Observations (informational, no action needed)

### O1 — `syncFromServer()` called without await in the App effect

The effect body is `syncFromServer()` (no await). This is correct: React
effects must return a cleanup function or `undefined`, not a Promise. The
fire-and-forget pattern is intentional; visible loading state is owned by
the panes, not this startup effect.

### O2 — `getDataDir` IPC failure silently leaves path input blank

`getDataDir().then(setDirInput).catch(() => {})` means a Tauri IPC failure
leaves `dirInput` at `""`. This is acceptable: the user sees an empty field
and can type the path manually. The existing tests do not cover this path
and none were added — the risk is low.

### O3 — `mkRes` and `makeFetchSeq` promotion removes test duplication

Both helpers were previously defined twice: once inside the local-backup
describe block and once inline in the syncFromServer tests. Promoting them
to module scope is a net improvement with no behaviour change.

---

## What is correct and should be kept

- Two independent try/catch blocks in `syncFromServer` — note failure cannot
  abort task sync.
- Early-return guard — no network calls when `getServerUrl()` is empty.
- Raw-text formula identical to `backupTasksLocally` — consistent contract.
- No new state in `App.tsx`; effect fires on mount and after every
  settings-close (covers connect and disconnect).
- `isLocal` variable fully removed — no dead code left.

---

## Review plan

No findings require implementation. No further iteration needed.
