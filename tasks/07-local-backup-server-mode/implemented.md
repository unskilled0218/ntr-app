# 07 - Implemented

## Changes

### `src/api.ts`

Added two private helpers after the existing HTTP helpers:

- `backupNoteLocally(text)` — calls `invoke("put_note", { text })`, logs a
  `console.warn` on failure, never rejects.
- `backupTasksLocally()` — fetches `GET /api/tasks` (no filter, so all tasks
  including completed are returned), joins their `raw` fields as todo.txt text,
  calls `invoke("put_raw", { text })`, logs a `console.warn` on failure, never
  rejects.

Updated six exported functions to `async` and added backup calls after each
successful server write:

| Function | Backup call |
|---|---|
| `putNote` | `backupNoteLocally(text)` |
| `createTask` | `backupTasksLocally()` |
| `updateTask` | `backupTasksLocally()` |
| `completeTask` | `backupTasksLocally()` |
| `uncompleteTask` | `backupTasksLocally()` |
| `deleteTask` | `backupTasksLocally()` |

Read functions (`getNote`, `listTasks`) and `onChange` are unchanged.

### `src/api.test.ts`

Added module-level `vi.mock` for `@tauri-apps/api/core` and
`@tauri-apps/api/event` so `invoke` is a controllable spy.

Added `makeFetchSeq` helper (creates fresh `Response` objects per call to avoid
"body already read" errors across sequential fetch calls).

Added describe block `"server mode — local backup"` with 10 tests covering:
- Each of the 6 mutating functions calls the correct `invoke` command.
- The backup fetch URL is exactly `SERVER + "/api/tasks"` with no query string.
- Local backup failure (rejected `invoke`) does not reject the outer promise
  (one test for tasks, one for note).
- Empty task list produces `""` as the raw text (local store cleared).

## Test results

- `npx vitest run` — 61 tests pass (9 test files).
- `npm run build` — TypeScript clean, Vite bundles.
- No Rust changes; `cargo test` not re-run (no Rust code touched).
