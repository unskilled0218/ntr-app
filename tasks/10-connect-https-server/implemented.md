# 10 - Connect to an HTTPS server behind a reverse proxy — implemented

Implements `plan.md` (plan-review score 97/100). Server mode now reaches an HTTPS
reverse proxy with a self-signed certificate (e.g. `https://ntr.lan`) because all
server-mode traffic — request/response and the live SSE stream — goes through the
native Rust backend instead of the webview, with an opt-in "allow self-signed
certificate" setting.

## Changes

### Rust (`src-tauri/`)

- **`Cargo.toml`** — added `reqwest = { version = "0.13", default-features = false,
  features = ["stream", "default-tls"] }` and `futures-util`. `default-tls` links the
  system OpenSSL already present in the image (no cmake/nasm needed); `stream` gives
  `bytes_stream()` for the SSE bridge.
- **`src/http.rs`** (new) — the one home for native HTTP:
  - `server_fetch(req: ServerRequest) -> HttpResponse` — single request/response
    primitive. A non-2xx status is `ok: false` (not an `Err`); only network/DNS/TLS
    errors are `Err`. `status_text` carries `canonical_reason()` so the frontend
    rebuilds the same `"<status> <statusText>"` message it threw before.
  - `server_connect` / `server_disconnect` — start/stop an SSE bridge that GETs
    `/api/events` and re-emits each `data:` token as the existing Tauri `change`
    event (`watch::CHANGE_EVENT`), so the frontend handler is identical in both modes.
  - `client_for` — caches one reqwest client keyed by the cert flag;
    `danger_accept_invalid_certs` is only ever `true` when the user opted in.
  - `sse_tokens` — pure SSE-frame parser, unit-tested in isolation (5 tests:
    whole frame, split-across-reads, multiple frames, comment/event/empty-data
    ignored, CRLF).
- **`src/state.rs`** — `AppState` gains `http_client` (cached client + cert flag)
  and `sse_task` (the live bridge's `JoinHandle`), both mutex-guarded.
- **`src/lib.rs`** — `mod http;` and registered the three new commands.

### Frontend (`src/`)

- **`settings.ts`** — `getAllowInvalidCert` / `setAllowInvalidCert` (key
  `ntr.allowInvalidCert`, absent == off), mirroring `setServerUrl`.
- **`api.ts`** — the transport seam, unchanged public surface:
  - `serverFetch` invokes `server_fetch` and throws on `!ok`; `httpJson` /
    `httpText` / `httpPutText` re-expressed on top of it (no more webview `fetch`).
  - `onChange` (server mode) now `invoke("server_connect")` then
    `listen(CHANGE_EVENT)`, returning an unlisten that also calls
    `server_disconnect`. Both modes share the `listen` path (no more `EventSource`).
- **`components/SettingsModal.tsx`** — "Allow self-signed certificates" checkbox
  with a one-line hint, in the Connection section.
- **`style.css`** — `.settings-checkbox` row layout.

`App.tsx`, `lib/conflict.ts`, and the other components are untouched: they call
`api.ts`, whose exported signatures did not change. `App.tsx`'s existing
`connectionKey` re-subscribe tears down and restarts the SSE bridge on connect.

## Verification

- `npx vitest run` — 88 passed (api.test.ts rewritten to drive `invoke("server_fetch")`;
  settings.test.ts gains allow-invalid-cert cases).
- `npm run build` (tsc + vite) — clean.
- `cd src-tauri && cargo test` — 35 passed (incl. 5 new `sse_tokens` tests).
- `cargo clippy --all-targets` — clean, no warnings.

End-to-end against a live `https://ntr.lan` is the user's environment; by design,
with the checkbox on, `server_fetch` succeeds where the webview `fetch` failed
because TLS validation is handled natively.
