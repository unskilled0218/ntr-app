# Review-fix plan — 09 server/local conflict

Addresses the two findings in `code-review.md`.

## Fix 1 (Warning) — unify the server-todo.txt rendering onto `/api/raw`

`backupTasksLocally` is the last place that rebuilds the server's todo.txt by
hand. Route it through the same `/api/raw` path the conflict code already uses,
so there is exactly one canonical "server todo.txt as text" source.

**`src/api.ts`** — replace:

```ts
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

with:

```ts
async function backupTasksLocally(): Promise<void> {
  try {
    const raw = await httpText("/api/raw");
    await invoke("put_raw", { text: raw });
  } catch (e) {
    console.warn("local task backup failed:", e);
  }
}
```

This removes the join + trailing-newline bookkeeping (it now lives only in the
server's `raw()` render, fetched verbatim) and makes the backup path
byte-identical to the reconcile path by construction.

### Test changes — `src/api.test.ts`, `describe("server mode — local backup")`

The backup's second fetch is now `GET /api/raw` returning text, not
`GET /api/tasks` returning JSON. Update the block:

- Replace the explanatory comment about the `[[tasks]]` array body with one
  noting the second fetch is `/api/raw` returning the raw todo.txt text.
- `createTask` / `updateTask` / `completeTask` / `uncompleteTask`: change the
  backup response from `[[TASK]]` to `[TASK.raw + "\n"]`; the `put_raw`
  assertion (`{ text: TASK.raw + "\n" }`) is unchanged.
- `deleteTask`: `makeFetchSeq([null, 204], [TASK.raw + "\n"])`.
- "backup fetch uses exact URL with no query string": assert the backup URL is
  `` `${SERVER}/api/raw` `` (was `/api/tasks`); the no-`?` check stays.
- "backup produces empty string for an empty task list": backup response `[""]`
  (an empty `/api/raw` body); assertion `put_raw { text: "" }` unchanged.
- "local task backup failure does not reject the primary promise": backup
  response `[TASK.raw + "\n"]`; `invoke` still mocked to reject; `createTask`
  still resolves to `TASK`.

No change to `backupNoteLocally` (it writes the text it was handed — no fetch,
no second rendering).

## Fix 2 (Suggestion) — number-agnostic dialog heading

**`src/components/ConflictDialog.tsx`** — change the `<h2>` text from
`{label} differ from the server` to `{label} out of sync with the server`
(reads correctly for both "Note" and "Tasks").

### Test change — `src/components/ConflictDialog.test.tsx`

Update the two heading assertions to `"Note out of sync with the server"` and
`"Tasks out of sync with the server"`.

## Verification

- `npx vitest run` → all pass.
- `npm run build` → tsc clean, Vite bundles.
- `cargo test` → unchanged.
