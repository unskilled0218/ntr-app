# 02 - Connect to server mode — implementation notes

Implements `plan.md` (which passed brooks-review at 97/100). Plan was updated to fix the
Warning (explicit `Content-Type: text/plain` on `putNote`) and the `connectionKey === 0`
suggestion (reload called directly in `onSettingsClose` instead of via a guarded effect).

## What was built

### `src/settings.ts` (new)

Two-function module: `getServerUrl()` / `setServerUrl()` backed by `localStorage` key
`"ntr.serverUrl"`. Empty string = local mode; non-empty = server mode. No other state.

### `src/api.ts` (modified)

Added `getServerUrl` import and two private HTTP helpers (`httpFetch`, `httpJson`). Each of
the 8 exported API functions now dispatches at call time:

- `getServerUrl()` non-empty → HTTP path (`fetch` / `EventSource`)
- Otherwise → existing Tauri path (`invoke` / `listen`), unchanged

HTTP dispatch:
- `listTasks` — `GET /api/tasks` with query params (null params omitted)
- `createTask`, `updateTask` — `POST`/`PUT` with JSON body
- `completeTask`, `uncompleteTask` — `POST` with no body
- `deleteTask` — `DELETE`, returns `void`
- `getNote` — `GET /api/note`, reads `res.text()`
- `putNote` — `PUT /api/note` with `Content-Type: text/plain`
- `onChange` — creates an `EventSource` at `url + "/api/events"`, listens for the `"change"`
  named event (SSE `event: change\ndata: tasks|note`), returns `() => es.close()`

### `src/components/SettingsModal.tsx` (new)

Native `<dialog>` controlled by a `useEffect` calling `showModal()`/`close()`. Props:
`open: boolean`, `onClose(): void`. Controlled text input pre-filled from `getServerUrl()`.
Two buttons: **Connect** (validates `http` prefix, saves URL) and **Use local files** (clears
URL). Inline error if validation fails. No network probe on connect.

### `src/App.tsx` (modified)

- Added `settingsOpen` and `connectionKey` state.
- `onSettingsClose()` increments `connectionKey` (re-wires the `onChange` subscription via
  its `[connectionKey]` dep) and explicitly reloads both panes — no magic sentinel.
- Added `<button className="settings-btn">` absolutely positioned top-right showing `[S]`
  (server) or `[L]` (local) as a mode badge.
- `<SettingsModal>` rendered at the bottom of `<main>`.

### `src/style.css` (modified)

- `position: relative` on `main` to anchor the absolute settings button.
- `.settings-btn`: top-right monospace badge button.
- `dialog#settings-modal` + `#settings-form` + `.settings-current`: consistent with existing
  `dialog#label-modal` styling.

## Verification

- `npx vitest run` → **42 passed** (22 existing + 4 settings + 14 api server-mode + 2 NotePane)
- `npm run build` → TypeScript clean, Vite bundles (213 kB JS, 5.7 kB CSS).
- `cargo test` → 20 pass (no Rust changes).
- Smoke test: `POST /api/tasks`, `GET /api/tasks`, `PUT /api/note`, `GET /api/note`,
  `DELETE /api/tasks/1` all return expected status codes and bodies against 127.0.0.1:8082.

### Not run here (headless container)

The interactive flow (open settings, enter `http://127.0.0.1:8082`, add/complete tasks, edit
note, verify live SSE updates across panes, switch back to local mode) requires a display for
`npm run tauri dev`. The HTTP plumbing is tested via the server smoke tests and the unit tests.

## Deviations from the plan

None. The `connectionKey === 0` guard was eliminated per the review suggestion: reload is
called explicitly in `onSettingsClose()` instead.
