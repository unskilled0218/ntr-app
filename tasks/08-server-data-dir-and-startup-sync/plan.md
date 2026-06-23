# 08 - Data directory in server mode + startup sync

## Goals

Two independent improvements to server mode:

1. **Data directory always accessible** — the local save-path setting is
   currently hidden when a server URL is configured. Because task 07 introduced
   local backups, the save path is equally relevant in server mode and should
   always be visible.

2. **Startup sync** — when the app opens (or reconnects) in server mode it
   should immediately fetch the latest note and all tasks from the server and
   write them to the local files, so the local backup is current even for
   changes made by other clients since the last session.

---

## Design

### Feature 1 — `src/components/SettingsModal.tsx`

**Current:** the entire "Data directory" section is wrapped in `{isLocal && (...)}` and `getDataDir()` is called only when `isLocal` is true.

**Change:**
- Remove the `isLocal` variable (unused after the guard is gone).
- Always call `getDataDir()` when the dialog opens (move it out of the `isLocal` branch).
- Always render the data-directory section.
- Update the hint text from  
  `"Directory where todo.txt and Note.md are stored."` to  
  `"Directory where todo.txt and Note.md are stored locally."` — the word "locally" makes the distinction clear in server mode.

The `setDataDir()` call in `applyDir` already goes through `invoke` directly (no server URL check), so no change is needed there.

### Feature 2 — `src/api.ts` + `src/App.tsx`

**`src/api.ts`** — new exported function:

```ts
export async function syncFromServer(): Promise<void> {
  if (!getServerUrl()) return;
  try {
    const note = await httpFetch("/api/note").then((r) => r.text());
    await invoke("put_note", { text: note });
  } catch (e) {
    console.warn("startup note sync failed:", e);
  }
  try {
    const tasks = await httpJson<Task[]>("/api/tasks");
    const raw = tasks.map((t) => t.raw).join("\n") + (tasks.length ? "\n" : "");
    await invoke("put_raw", { text: raw });
  } catch (e) {
    console.warn("startup task sync failed:", e);
  }
}
```

- Runs only in server mode (early return when no URL).
- Two independent try/catch blocks so a note failure does not abort the task sync.
- Uses the existing `backupTasksLocally`-style raw-text approach for tasks (same
  trailing-newline logic, same rationale).
- Best-effort: failures are logged but never surfaced to the UI.

**`src/App.tsx`** — new effect:

```ts
useEffect(() => {
  syncFromServer();
}, [connectionKey]);
```

`connectionKey` is already bumped on mount (starts at 0, effect runs once) and
after every settings-close (server URL may have changed). This covers:

- App open in server mode → syncs immediately.
- User connects to a server → syncs after settings close.
- User disconnects → `syncFromServer` returns immediately because
  `getServerUrl()` returns `""` — no network calls are made.

No new state is needed. The effect is fire-and-forget (no `await`); the pane
`onTasksChanged` / `onNoteChange` calls already in `onSettingsClose` drive the
visible UI refresh independently.

---

## Files changed

| File | Change |
|---|---|
| `src/components/SettingsModal.tsx` | Remove `isLocal` guard from data-dir section; always load and render it |
| `src/api.ts` | Add `syncFromServer()` |
| `src/App.tsx` | Add `useEffect` calling `syncFromServer()` on `connectionKey` change |

---

## Tests

### `src/api.test.ts` — new describe block `"syncFromServer"`

- **No-op in local mode**: set localStorage to empty, call `syncFromServer()`,
  assert `fetch` was not called.
- **Syncs note**: mock `GET /api/note` → `"note text"`, assert `invoke("put_note",
  { text: "note text" })` was called.
- **Syncs tasks**: mock `GET /api/tasks` → `[TASK]`, assert `invoke("put_raw",
  { text: TASK.raw + "\n" })` was called.
- **Note failure does not prevent task sync**: use
  `makeFetchSeq([null, 404], [[TASK]])` so the note fetch returns 404 (which
  triggers `httpFetch`'s `!res.ok` throw); assert `invoke("put_raw", ...)` was
  still called despite the note failure.
- **No-op when server URL absent after returning to local mode**: clear URL mid-
  test and call again; `fetch` not called on the second invocation.

### `src/components/SettingsModal` — no new automated tests

The data-directory section visibility change is a render-level condition; the
existing component tests do not cover this modal. Verified manually: the section
renders regardless of whether a server URL is set.

---

## Verification

- `npx vitest run` → all existing tests + new tests pass.
- `npm run build` → TypeScript clean, Vite bundles.
- `cargo test` → unchanged (no Rust changes).
