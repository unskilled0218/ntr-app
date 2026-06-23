# 07 - Local backup in server mode

## Goal

When the user is connected to a remote server, every write to the note or the
task list is also persisted to the local todo.txt and Note.md files via the
existing Tauri commands. Reads always come from the server (unchanged). Local
copies are best-effort: a local write failure does not fail the primary server
operation, but is logged so it can be diagnosed.

## Motivation

In server mode today, local files are ignored entirely. If the server becomes
unavailable the user loses access to all their data. A transparent local mirror
means the user can switch back to local mode and find their most-recent content
intact, without any manual export step.

---

## Design

All changes live in `src/api.ts`. No Rust changes, no other frontend files
change.

### Two private helpers

```ts
async function backupNoteLocally(text: string): Promise<void> {
  try {
    await invoke("put_note", { text });
  } catch (e) {
    console.warn("local note backup failed:", e);
  }
}

async function backupTasksLocally(): Promise<void> {
  try {
    const tasks = await httpJson<Task[]>("/api/tasks");
    const raw = tasks.map((t) => t.raw).join("\n") + (tasks.length ? "\n" : "");
    await invoke("put_raw", { text: raw });
  } catch (e) {
    console.warn("local task backup failed:", e);
  }
}
```

`backupTasksLocally` fetches **all** tasks from the server (no filter → server
returns completed and active tasks alike) and writes their raw todo.txt lines to
the local store in one atomic call. Ordering and content match the server's
current file exactly.

The `console.warn` in each catch block preserves the best-effort semantic (the
server write is not aborted) while making silent failures observable in DevTools
and Tauri's log output.

### Updated server-mode branches

| Function | Added local call |
|---|---|
| `putNote` | `await backupNoteLocally(text)` after the server `httpFetch` resolves |
| `createTask` | `await backupTasksLocally()` after `httpJson` resolves |
| `updateTask` | `await backupTasksLocally()` after `httpJson` resolves |
| `completeTask` | `await backupTasksLocally()` after `httpJson` resolves |
| `uncompleteTask` | `await backupTasksLocally()` after `httpJson` resolves |
| `deleteTask` | `await backupTasksLocally()` after `httpFetch` resolves |

Read operations (`getNote`, `listTasks`) and the subscription (`onChange`) are
unchanged — reads always come from the server.

### Why a full sync rather than mirroring the individual mutation locally

The local store assigns its own IDs and date-stamps tasks independently of the
server. Calling `invoke("create_task")` locally in addition to the server write
would double-create the task and produce mismatched IDs. A full `put_raw` call
is the only path that keeps the two stores in sync without duplicating tasks or
mismatching completion dates.

### Trailing newline handling

`Task::to_string()` (the Rust `Display` impl) emits the task line without a
trailing newline. The `raw` field in the DTO is `e.task.to_string()`, so it
contains no trailing newline.

`tasks.map(t => t.raw).join("\n") + (tasks.length ? "\n" : "")` therefore
produces the same format the Rust store writes (`render` in store.rs appends
`\n` after each task). An empty task list writes `""`, matching a missing file
(treated as empty by the store).

---

## Files changed

| File | Change |
|---|---|
| `src/api.ts` | Add `backupNoteLocally` and `backupTasksLocally` helpers; call them in the five task-mutation functions and `putNote` |

No Rust changes. No changes to components, settings, config, or test files
beyond what is listed below.

---

## Tests

### `src/api.test.ts` (extend existing)

New test group: `"server mode — local backup"`.

For each mutating function, after the mock server responds:

- `putNote`: verify `invoke` was called with `"put_note"` and the exact same
  text string passed to `putNote`.
- `createTask`, `updateTask`, `completeTask`, `uncompleteTask`, `deleteTask`:
  verify a second `fetch` was called with the URL `serverUrl + "/api/tasks"`
  and **no query string** (assert the URL has no `?`); verify `invoke` was
  called with `"put_raw"` and the joined raw lines of all tasks returned by
  the mock.

Local failure does not propagate: for one representative function (e.g.
`createTask`), mock `invoke` to reject and verify that the outer promise still
resolves. Applies to both note and task helpers.

---

## Verification

- `npx vitest run` → all existing tests + new tests pass.
- `npm run build` → TypeScript clean, Vite bundles.
- `cargo test` → all Rust tests pass (no Rust changes).
