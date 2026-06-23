# 02 - Connect to server mode

## Goal

Add a runtime-switchable server-connect mode. A settings dialog lets the user enter a
`my-ntr-server` URL; from that point every API call goes through HTTP + SSE instead of Tauri
`invoke` / `listen`. Clearing the URL returns the app to local-file mode. No Rust code changes.

## Motivation

`api.ts` was written as a transport shim with the explicit comment: *"a future 'with server'
mode swaps this file alone."* This task realises that intent. The Tauri app becomes both a
local-file client and a desktop front-end for a shared server instance.

---

## Design

### `src/settings.ts` (new)

Single responsibility: persist and retrieve the server URL.

```ts
const KEY = "ntr.serverUrl";
export function getServerUrl(): string { return localStorage.getItem(KEY) ?? ""; }
export function setServerUrl(url: string): void {
  url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY);
}
```

A non-empty string means server mode; empty string means local mode. No other state.

### `src/api.ts` (modified)

Keep the exact same exported interface. Add an internal `httpFetch` helper and
a dispatch at the top of each function:

```
serverUrl = getServerUrl()
if (serverUrl) → HTTP path
else           → Tauri path (existing code, unchanged)
```

**HTTP helpers (private):**

```ts
async function httpFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(getServerUrl() + path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}
async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await httpFetch(path, init)).json() as Promise<T>;
}
```

**Per-function HTTP dispatch:**

| Export | HTTP call |
|---|---|
| `listTasks(filter)` | `GET /api/tasks?completed=&priority=&project=&context=` (omit null params) |
| `createTask(text)` | `POST /api/tasks` body `{"text":"..."}` |
| `updateTask(id,text)` | `PUT /api/tasks/{id}` body `{"text":"..."}` |
| `completeTask(id)` | `POST /api/tasks/{id}/complete` |
| `uncompleteTask(id)` | `POST /api/tasks/{id}/uncomplete` |
| `deleteTask(id)` | `DELETE /api/tasks/{id}` |
| `getNote()` | `GET /api/note` → `res.text()` |
| `putNote(text)` | `PUT /api/note` body = plain text, `Content-Type: text/plain` |

**`onChange` in server mode:**

The server emits SSE on `GET /api/events` as:
```
event: change
data: tasks
```

```ts
const es = new EventSource(getServerUrl() + "/api/events");
es.addEventListener("change", (e) => handler((e as MessageEvent).data));
return Promise.resolve(() => es.close());
```

The Tauri path is the existing `listen(…)` call, unchanged.

### `src/components/SettingsModal.tsx` (new)

A `<dialog>` element (native modal, keyboard-accessible). Props:
- `open: boolean`
- `onClose(): void`

Internal state: a controlled `<input>` pre-filled with `getServerUrl()` when opened.

Two buttons:
- **Connect** — trims the input, validates it starts with `"http"`, calls
  `setServerUrl(trimmed)`, then `onClose()`. Shows an inline error if invalid.
- **Use local files** — calls `setServerUrl("")`, then `onClose()`.

Current mode is shown above the input: *"Local (files)"* or *"Server: {url}"*.

No network probe on connect — the first real API call will show an error if unreachable.

### `src/App.tsx` (modified)

**Settings button:** a `<button>` labelled `"Settings"` placed in the `<nav
className="bottom-nav">` alongside the existing Note/Todo buttons. On desktop (nav is
`display:none`) it is placed as an `<aside>` in the top-right corner of `<main>`.

Actually, simpler: add a `<button className="settings-btn">` as a sibling of `<nav>` inside
`<main>`, always visible (positioned top-right via CSS, fixed within the pane area). Clicking
it sets `settingsOpen = true`.

**`connectionKey` state:** an integer starting at 0. Incremented whenever the settings modal
closes. The `onChange` `useEffect` lists `[connectionKey]` as its only dependency, so closing
settings re-wires the live event subscription to whichever transport is now active.

```ts
const [settingsOpen, setSettingsOpen] = useState(false);
const [connectionKey, setConnectionKey] = useState(0);

function onSettingsClose() {
  setSettingsOpen(false);
  setConnectionKey((k) => k + 1); // re-wire onChange subscription
  // Explicit reload — caller knows mode just changed, no magic sentinel needed.
  todoRef.current?.onTasksChanged();
  noteRef.current?.onNoteChange();
}

// In the onChange useEffect, dep = [connectionKey]:
useEffect(() => {
  let unlisten: (() => void) | undefined;
  let cancelled = false;
  onChange((kind) => { … }).then((un) => { … });
  return () => { cancelled = true; unlisten?.(); };
}, [connectionKey]);
```

**Settings indicator:** the settings button shows `"[S]"` (server) or `"[L]"` (local) as a
tiny badge so the user can see the current mode at a glance.

---

## Files changed

| File | Change |
|---|---|
| `src/settings.ts` | New: `getServerUrl` / `setServerUrl` |
| `src/api.ts` | Add HTTP dispatch; `onChange` SSE branch; import `getServerUrl` |
| `src/components/SettingsModal.tsx` | New: URL input + connect/disconnect dialog |
| `src/App.tsx` | Settings button, `SettingsModal`, `connectionKey` re-wire |
| `src/style.css` | Minimal: `.settings-btn` positioning |

No Rust changes. No changes to `config.ts`, `markdown.ts`, `labels.ts`, `lib/`.

---

## Tests

### `src/settings.test.ts` (new)

- `getServerUrl()` returns `""` when key absent.
- `setServerUrl("http://…")` persists; `getServerUrl()` returns it.
- `setServerUrl("")` removes the key; `getServerUrl()` returns `""`.
- Uses vitest's `localStorage` mock (jsdom).

### `src/api.test.ts` (extend existing)

Existing tests cover the Tauri-local path. New tests mock `fetch` (`vi.fn`) and `EventSource`
(`vi.stubGlobal`) and cover the server path:

- Each of the 8 HTTP functions: verify correct method, URL (with filter params for
  `listTasks`), and body (for create/update/putNote).
- `onChange` server: EventSource is created with the right URL; the `"change"` event listener
  fires the handler with the data; the returned unlisten closes the EventSource.
- Error mapping: a 404 response throws a message containing `"404"`; `errMsg` on the throw
  returns a non-empty string.

---

## Verification

- `npx vitest run` → all existing 22 + new tests pass.
- `npm run build` → TypeScript clean, Vite bundles.
- `cargo test` → 20 pass (no Rust changes).
- Manual (server on 127.0.0.1:8082):
  - Open settings, enter `http://127.0.0.1:8082`, click Connect.
  - Add/complete/delete tasks — visible in the server's own WebUI.
  - Edit the note — visible in the server's own WebUI.
  - Edit `todo.txt` on the server side — live update arrives in the Tauri app via SSE.
  - Open settings, click "Use local files" — app reads local files again.
