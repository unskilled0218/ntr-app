# 10 - Connect to an HTTPS server behind a reverse proxy

## Goal

Let the desktop client connect to a `my-ntr-server` reached over **HTTPS at a
private hostname** (e.g. `https://ntr.lan`) served by an nginx reverse proxy
with a **self-signed / private-CA certificate**. Today such a connection fails
outright ("Can't connect to server"), while `http://127.0.0.1:8080` works.

The fix routes all server-mode traffic — both the request/response calls and the
live-update SSE stream — through the Rust backend instead of the webview, and
adds an opt-in "allow self-signed certificate" setting for the local-server
case. No server-side change.

## Motivation — why it fails today, and why the fix must live in Rust

Server mode currently talks to the server straight from the webview:
`src/api.ts` uses the browser `fetch` (request/response) and `EventSource`
(SSE). That works against `http://127.0.0.1:8080` but breaks behind an HTTPS
reverse proxy for two reasons, both intrinsic to the webview:

1. **TLS trust.** A `ntr.lan` proxy almost always presents a self-signed or
   private-CA certificate. WebKitGTK (the Linux webview Tauri uses) rejects it
   and the `fetch`/`EventSource` fails with an opaque network error — exactly
   the reported "can't connect". The webview exposes **no** API to trust a
   specific certificate or relax validation; `tauri.conf.json`'s `csp` is
   already `null`, so CSP is not the blocker.
2. **CORS.** A webview `fetch` to a third-party origin is a CORS request. The
   server sets `CorsLayer::permissive()`, but a reverse proxy is free to drop or
   not forward those headers, leaving the response unreadable.

Both vanish when the request is made from native code: a Rust HTTP client is not
subject to CORS and **can** be configured to accept a self-signed certificate.
This is the standard Tauri remedy (the official `tauri-plugin-http` exists for
the same reason); we implement a small focused version because we also need the
SSE stream to share the same client and TLS policy.

## Design principle — one transport seam, now fully in Rust

`src/api.ts`'s header already declares it "the ONLY file that knows about Tauri
(`invoke`, `listen`) or the HTTP server (`fetch`, `EventSource`)". This task
*strengthens* that seam rather than widening it: server mode stops using
`fetch`/`EventSource` and goes through Tauri commands too. The payoff is
**conceptual integrity** — after this change **both** modes reach the backend
the same way:

| Concern | Local mode (unchanged) | Server mode (today) | Server mode (after) |
|---|---|---|---|
| Request / response | `invoke(cmd)` | `fetch(url)` | `invoke("server_fetch")` |
| Live updates | `listen("change")` | `EventSource` | `listen("change")` |

After this task, `onChange` uses `listen(CHANGE_EVENT)` in *both* modes; the only
difference is that server mode first asks Rust to start an SSE bridge that
translates the server's `change` events into the very same Tauri `change` event
the file-watcher already emits (`src-tauri/src/watch.rs`).

## Where each concern lives

| Concern | Home | Why |
|---|---|---|
| Native HTTP request + SSE bridge + TLS policy | `src-tauri/src/http.rs` (new) | The one place that owns the native HTTP client; mirrors how `watch.rs` owns the live-update emitter |
| Client lifetime + SSE task handle | `src-tauri/src/state.rs` (extend `AppState`) | Already the home for shared, mutex-guarded runtime state |
| Command registration | `src-tauri/src/lib.rs` | Already lists every command |
| The dependency | `src-tauri/Cargo.toml` | — |
| Transport dispatch (fetch vs invoke) | `src/api.ts` | The single transport seam; HTTP helpers are rewritten to invoke the new commands |
| "Allow self-signed cert" setting (persisted) | `src/settings.ts` | Already the home for localStorage-backed connection settings, next to `serverUrl` |
| The setting's checkbox | `src/components/SettingsModal.tsx` | Already the Connection UI |

`src/App.tsx`, `src/lib/conflict.ts`, and every component other than
`SettingsModal` are **unchanged** — they call `api.ts`, which keeps the same
exported signatures.

---

## Rust side

### 1. Dependency — `src-tauri/Cargo.toml`

```toml
reqwest = { version = "0.13", default-features = false, features = ["stream", "default-tls"] }
futures-util = "0.3"
```

- `default-tls` links the system OpenSSL (3.5, already present in this image), so
  no extra C-build tooling (cmake/nasm for an aws-lc-rs rustls build) is needed.
  `reqwest`'s `danger_accept_invalid_certs` is supported with this backend.
- `stream` gives `Response::bytes_stream()` for the SSE bridge.
- We deliberately do **not** add the `json` feature: the backend exchanges
  request/response bodies as opaque strings (the frontend already owns
  JSON encode/decode), so Rust stays a dumb pipe.
- `futures-util` (already in the cargo cache, used by the server) provides
  `StreamExt::next()` for reading the SSE byte stream.

### 2. `src-tauri/src/http.rs` (new)

Two responsibilities, both about "talk to the server natively":

**a) `server_fetch` command — one request, one response.**

The request fields travel as **one struct**, not five positional args, so a future
connection option (auth token, timeout, custom CA) widens one type instead of every
signature and call site:

```rust
#[derive(serde::Deserialize)]
pub struct ServerRequest {
  pub url: String,                  // absolute: server base + path, composed by api.ts
  pub method: String,               // "GET" | "POST" | "PUT" | "DELETE"
  pub body: Option<String>,         // request body, already-encoded by the caller
  pub content_type: Option<String>, // e.g. "application/json" / "text/plain"
  pub allow_invalid_cert: bool,     // the cert policy for THIS connection (from settings.ts)
}

#[derive(serde::Serialize)]
pub struct HttpResponse {
  pub status: u16,
  pub ok: bool,
  pub status_text: String,          // reqwest canonical_reason(), to rebuild "<status> <text>"
  pub body: String,
}

#[tauri::command]
pub async fn server_fetch(
  state: tauri::State<'_, AppState>,
  req: ServerRequest,
) -> Result<HttpResponse, String>
```

- Builds (or reuses) a client via `client_for(state, req.allow_invalid_cert)` and
  issues the request. Network/DNS/TLS errors map to `Err(e.to_string())` — the
  only path that can carry a self-signed-cert failure message back to the UI.
- A non-2xx **HTTP** response is **not** an `Err`: it returns
  `HttpResponse { ok: false, .. }`, leaving the "throw on !ok" decision in
  `api.ts` (see below), exactly mirroring today's `httpFetch`. `status_text` carries
  `StatusCode::canonical_reason()` so the frontend can reconstruct today's
  `"<status> <statusText>"` error message verbatim (preserving the human-readable
  reason in error toasts).

**b) `server_connect` / `server_disconnect` commands — the SSE bridge.**

```rust
#[tauri::command]
pub async fn server_connect(
  app: tauri::AppHandle,
  state: tauri::State<'_, AppState>,
  url: String,                  // absolute /api/events URL, composed by api.ts
  allow_invalid_cert: bool,
) -> Result<(), String>

#[tauri::command]
pub fn server_disconnect(state: tauri::State<'_, AppState>)
```

- `server_connect` first aborts any existing bridge (idempotent re-subscribe),
  then `tauri::async_runtime::spawn`s a task that GETs the events URL and reads
  `response.bytes_stream()`. It accumulates bytes, splits on `\n`, and for each
  `data: <token>` line `app.emit(watch::CHANGE_EVENT, token)` — re-using the
  exact event name and `"tasks"`/`"note"` payloads the file-watcher already
  emits, so the frontend handler is identical for both modes. The
  `JoinHandle` is stored in `AppState` so `server_disconnect` can `.abort()` it.
- SSE framing kept minimal but correct: handle multi-line buffering (a frame may
  arrive split across reads), ignore comment/`event:`/empty lines, and only act
  on `data:` lines. This is a strict subset of the server's emitter
  (`server/src/api.rs`), which sends `event: change\ndata: <token>\n\n`.
- The stream ending or erroring just ends the task quietly (best-effort, like
  `EventSource` today, which silently stopped on error). Reconnect happens
  through the existing `connectionKey` re-subscribe in `App.tsx`.

**c) The client + TLS policy — `client_for`.**

```rust
// A reqwest client owns a connection pool and is meant to be reused, not rebuilt
// per call. We cache one, keyed by the single thing that changes its construction:
// the cert policy. Rebuilt only when allow_invalid_cert flips.
fn client_for(state: &AppState, allow_invalid_cert: bool) -> Result<reqwest::Client, String>
```

- Builds with `.danger_accept_invalid_certs(allow_invalid_cert)`. When the flag
  is `false` (the default) validation is normal; when `true` the user has opted
  in for their local server. A doc-comment states the security trade-off plainly.
- **Why cache rather than build per request (the reason, recorded per review):** the
  backup path fires two requests back-to-back per mutation — e.g. `createTask` does
  `POST /api/tasks` then `GET /api/raw` (see `backupTasksLocally`) — to the same
  host, so a pooled client reuses the TLS connection for the second call instead of
  re-handshaking. The cache is one `Option<(bool, Client)>` behind the existing
  state mutex; the `bool` IS the cache key (rebuild iff it differs), so there is no
  separate key type to keep in sync.

### 3. `src-tauri/src/state.rs` — extend `AppState`

Add two mutex-guarded fields, leaving the existing `store` / `note` untouched:

```rust
pub http_client: Mutex<Option<(bool, reqwest::Client)>>, // cached client + its cert flag
pub sse_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>, // the live SSE bridge
```

`AppState::new` initialises both to `None`. Rationale comment: same "shared,
mutex-guarded runtime state" role the struct already documents.

### 4. `src-tauri/src/lib.rs`

- `mod http;`
- Register `http::server_fetch`, `http::server_connect`, `http::server_disconnect`
  in `generate_handler!`.
- On `Drop`/exit nothing special is needed: aborting the SSE task on
  `server_disconnect` (called from the frontend cleanup) and on process exit is
  sufficient; the task only holds a network read.

---

## Frontend side

### 5. `src/settings.ts` — the new setting

Mirror the existing `serverUrl` accessors exactly (a boolean stored under one
key, absent == default/false):

```ts
const ALLOW_INVALID_CERT_KEY = "ntr.allowInvalidCert";

export function getAllowInvalidCert(): boolean {
  return localStorage.getItem(ALLOW_INVALID_CERT_KEY) === "1";
}
export function setAllowInvalidCert(allow: boolean): void {
  allow ? localStorage.setItem(ALLOW_INVALID_CERT_KEY, "1")
        : localStorage.removeItem(ALLOW_INVALID_CERT_KEY);
}
```

### 6. `src/api.ts` — rewrite the HTTP helpers to invoke Rust

The exported surface (`listTasks`, `createTask`, … `onChange`,
`reconcileWithServer`, `resolveConflict`, `getNote`, `putNote`) is **unchanged**.
Only the private transport helpers change, so every caller and the
conflict/backup logic stay byte-for-byte the same.

- Replace the `fetch`-based core with one helper:

```ts
interface HttpResponse { status: number; ok: boolean; status_text: string; body: string; }

// The single server-mode request primitive, now native (Rust) instead of a
// webview fetch, so it reaches HTTPS reverse proxies with self-signed certs and
// is not subject to CORS. Throws on a non-2xx status to preserve httpFetch's
// contract (callers and tests rely on the thrown status text).
async function serverFetch(
  path: string,
  method = "GET",
  body?: string,
  contentType?: string,
): Promise<string> {
  const res = await invoke<HttpResponse>("server_fetch", {
    req: {
      url: getServerUrl() + path,
      method,
      body: body ?? null,
      content_type: contentType ?? null,
      allow_invalid_cert: getAllowInvalidCert(),
    },
  });
  // Mirror httpFetch verbatim: "<status> <statusText>".
  if (!res.ok) throw new Error(`${res.status} ${res.status_text}`.trim());
  return res.body;
}
```

- Re-express the existing helpers on top of it, keeping their names/signatures so
  the rest of the file is untouched:
  - `httpText(path)` → `serverFetch(path)`
  - `httpPutText(path, text)` → `serverFetch(path, "PUT", text, "text/plain")` (returns void)
  - `httpJson<T>(path, init?)` → call `serverFetch` with `init?.method ?? "GET"`,
    `init?.body`, and `"application/json"` when a body is present, then
    `JSON.parse`. The handful of `httpJson(..., { method, headers, body })`
    call-sites change only in that they no longer build a `Headers`/`RequestInit`
    object — they pass method + body. (Concretely: the POST/PUT bodies are
    already `JSON.stringify(...)` strings, so they pass straight through.)
  - `httpFetch(path, { method: "DELETE" })` for `deleteTask` → `serverFetch(path, "DELETE")`.
- `CONFLICT_IO`'s server side already uses `httpText`/`httpPutText`, so it inherits
  the new transport with no change.

- `onChange` (server mode) becomes:

```ts
export async function onChange(handler: (kind: string) => void): Promise<UnlistenFn> {
  if (getServerUrl()) {
    await invoke("server_connect", {
      url: getServerUrl() + "/api/events",
      allowInvalidCert: getAllowInvalidCert(),
    });
    const un = await listen<string>(CHANGE_EVENT, (e) => handler(e.payload));
    return () => { un(); invoke("server_disconnect").catch(() => {}); };
  }
  return listen<string>(CHANGE_EVENT, (e) => handler(e.payload));
}
```

This is the conceptual-integrity win: server and local now share the
`listen(CHANGE_EVENT)` path; only the bridge start/stop is extra. `App.tsx`'s
cleanup already calls the returned unlisten on every `connectionKey` change, so
the bridge is torn down and restarted on connect/disconnect with no App change.

### 7. `src/components/SettingsModal.tsx` — the checkbox

Add to the **Connection** section, below the Server URL input, a single
checkbox bound to `getAllowInvalidCert`/`setAllowInvalidCert` (same
read-in-`useEffect`, write-on-change pattern the conflict-strategy `<select>`
already uses):

```
[ ] Allow self-signed certificates (local servers only)
```

with a one-line `settings-hint` explaining it is for private HTTPS servers like
`https://ntr.lan` and should be left off otherwise.

---

## Testing

### Rust — `src-tauri/src/http.rs` (unit, no network)

- **SSE frame parsing** is the one piece of non-trivial logic and is extracted
  into a pure helper `fn sse_tokens(buf: &mut String) -> Vec<String>` (drains
  complete `data:` lines from a reassembly buffer, leaving any partial trailing
  line). Tests: a whole frame; a frame split across two reads; multiple frames in
  one read; `event:`/comment/blank lines ignored. No client or socket needed —
  this is the same "pure verdict, testable home" approach `lib/conflict.ts` and
  `lib/noteSync.ts` use on the TS side.
- `cargo test` + `cargo clippy --all-targets` stay green.

### TypeScript — `src/api.test.ts` (rewrite the transport stub)

The suite currently stubs the global `fetch`; it must instead drive
`invoke("server_fetch")`. The change is mechanical and localized to the helpers:

- Replace `makeFetch`/`makeFetchSeq`/`mkRes` with `mockServer(...)` helpers that
  set `vi.mocked(invoke)` to return `{ status, ok, status_text, body }` for
  `server_fetch` calls (while still dispatching `get_note`/`get_raw`/`put_note`/`put_raw`
  for the local-backup and reconcile branches, as the reconcile tests already do).
- URL/method/body assertions move from `expect(fetch).toHaveBeenCalledWith(url, init)`
  to `expect(invoke).toHaveBeenCalledWith("server_fetch", { req: { url, method, body, content_type, allow_invalid_cert } })`.
- The error-mapping tests assert `server_fetch` returning
  `{ ok: false, status: 404, status_text: "Not Found" }` makes the call reject with a
  message containing `"404"` (and keep one asserting the `status_text` is preserved).
- `onChange` test: stub `invoke` so `server_connect` resolves and `listen`
  captures the handler; assert `server_connect` is invoked with the `/api/events`
  URL + `allowInvalidCert`, that emitting via the captured `listen` handler calls
  back, and that the returned unlisten invokes `server_disconnect`. The
  `EventSource` mock is removed.
- All other suites (`errMsg`, reconcile, resolveConflict, local backup) keep
  their intent; only their transport stub changes.

Add `src/settings.test.ts` cases for `getAllowInvalidCert`/`setAllowInvalidCert`
(default false; set true persists "1"; set false removes the key) — matching the
existing `serverUrl`/strategy tests in that file.

### Manual / build verification

- `npx vitest run` green; `npm run build` (tsc) clean.
- `cd src-tauri && cargo build` compiles with the new reqwest dependency (first
  build pulls rustls — confirm it resolves from the cache/registry).
- End-to-end against `https://ntr.lan` is the user's environment; the design note
  for the reviewer: with the checkbox **on**, `server_fetch` succeeds where the
  webview `fetch` failed, because TLS validation is handled natively.

---

## What is explicitly out of scope

- **No certificate pinning / custom-CA import.** A single opt-in "accept invalid
  cert" toggle is enough for the reported local-server case; pinning is a larger
  feature with its own UI and storage and can come later.
- **No change to the server.** Every route and CORS setting it needs already
  exists.
- **No retry/back-off on the SSE bridge.** It mirrors today's `EventSource`
  behaviour (silent stop on error; re-subscribe via `connectionKey`); automatic
  reconnect is a separate improvement.
- **No proxy/auth headers.** The reverse proxy in the report terminates TLS and
  forwards unauthenticated, matching the userless server's "no auth by design".

## Security note

`danger_accept_invalid_certs(true)` disables TLS authentication for server-mode
traffic and is a real downgrade: on a hostile network a man-in-the-middle could
impersonate the server. It is therefore **off by default**, gated behind an
explicit checkbox, scoped to server mode only, and labelled "local servers
only". This is the minimum needed to reach a self-signed `ntr.lan` and is the
same trade-off `tauri-plugin-http`'s `danger.acceptInvalidCerts` exposes.
