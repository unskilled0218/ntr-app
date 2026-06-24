//! Native HTTP transport for server mode.
//!
//! Server mode used to talk to `my-ntr-server` straight from the webview (`fetch` + an
//! `EventSource` in src/api.ts). That breaks behind an HTTPS reverse proxy (e.g.
//! `https://ntr.lan`): WebKitGTK rejects the proxy's self-signed certificate and the webview
//! exposes no way to trust it, and a webview `fetch` to a third-party origin is also a CORS
//! request the proxy may not satisfy. Both problems vanish when the request is made from native
//! code, which is not subject to CORS and *can* be told to accept a self-signed certificate.
//!
//! So this module is the one place that owns the native HTTP client. It mirrors the seam in
//! src/api.ts: `server_fetch` is the single request/response primitive, and the
//! `server_connect`/`server_disconnect` pair bridges the server's SSE `change` stream onto the
//! very same Tauri `change` event the file-watcher already emits (see `watch.rs`) — so the
//! frontend's live-update handler is identical in both modes.

use crate::state::AppState;
use futures_util::StreamExt;
use tauri::{AppHandle, Emitter, State};

/// One server-mode request. Travels as a single struct (not five positional args) so a future
/// connection option widens one type, not every signature and call site. `serde(camelCase)`
/// matches the camelCase keys the frontend sends, consistent with Tauri's top-level arg naming.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerRequest {
  pub url: String,                  // absolute: server base + path, composed by api.ts
  pub method: String,               // "GET" | "POST" | "PUT" | "DELETE"
  pub body: Option<String>,         // request body, already-encoded by the caller
  pub content_type: Option<String>, // e.g. "application/json" / "text/plain"
  pub allow_invalid_cert: bool,     // the cert policy for THIS connection (from settings.ts)
}

/// The response, shaped for the frontend's `serverFetch`. A non-2xx status is NOT an error
/// here (`ok` is just `false`); the "throw on !ok" decision stays in api.ts, mirroring the old
/// `httpFetch`. `status_text` carries the canonical reason so the UI rebuilds the same
/// `"<status> <statusText>"` message it threw before.
#[derive(serde::Serialize)]
pub struct HttpResponse {
  pub status: u16,
  pub ok: bool,
  pub status_text: String,
  pub body: String,
}

/// A reqwest client owns a connection pool and is meant to be reused, not rebuilt per call. We
/// cache one in `AppState`, keyed by the only thing that changes its construction — the cert
/// policy — so a back-to-back pair like `POST /api/tasks` then `GET /api/raw` (the backup path)
/// reuses one TLS connection. Rebuilt only when `allow_invalid_cert` flips.
///
/// `danger_accept_invalid_certs(true)` disables TLS authentication and is a real downgrade; it
/// is only ever passed `true` when the user has explicitly opted in for a local server.
fn client_for(state: &AppState, allow_invalid_cert: bool) -> Result<reqwest::Client, String> {
  let mut guard = state.http_client.lock().map_err(|e| e.to_string())?;
  if let Some((flag, client)) = guard.as_ref() {
    if *flag == allow_invalid_cert {
      return Ok(client.clone());
    }
  }
  let client = reqwest::Client::builder()
    .danger_accept_invalid_certs(allow_invalid_cert)
    .build()
    .map_err(|e| e.to_string())?;
  *guard = Some((allow_invalid_cert, client.clone()));
  Ok(client)
}

/// Issue one request and return its outcome. Network/DNS/TLS errors (including a rejected
/// self-signed cert) map to `Err(String)`, the only path that carries such a message to the UI.
#[tauri::command]
pub async fn server_fetch(
  state: State<'_, AppState>,
  req: ServerRequest,
) -> Result<HttpResponse, String> {
  let client = client_for(state.inner(), req.allow_invalid_cert)?;
  let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
  let mut builder = client.request(method, &req.url);
  if let Some(body) = req.body {
    if let Some(ct) = req.content_type {
      builder = builder.header(reqwest::header::CONTENT_TYPE, ct);
    }
    builder = builder.body(body);
  }
  let res = builder.send().await.map_err(|e| e.to_string())?;
  let status = res.status();
  let status_text = status.canonical_reason().unwrap_or("").to_string();
  let body = res.text().await.map_err(|e| e.to_string())?;
  Ok(HttpResponse {
    status: status.as_u16(),
    ok: status.is_success(),
    status_text,
    body,
  })
}

/// Drain complete `data:` tokens from an SSE reassembly buffer.
///
/// A network read may split or merge SSE frames, so we buffer and only act on whole lines: every
/// line up to the last `\n` is consumed and any `data:` value yielded; the trailing partial line
/// (after the last `\n`) is left in `buf` for the next read. `event:`/comment/blank lines and
/// empty `data:` values are ignored. This is the one piece of non-trivial logic here, kept pure
/// and unit-tested in isolation.
fn sse_tokens(buf: &mut String) -> Vec<String> {
  let last_nl = match buf.rfind('\n') {
    Some(i) => i,
    None => return Vec::new(), // no complete line yet
  };
  let mut out = Vec::new();
  for line in buf[..=last_nl].lines() {
    if let Some(value) = line.strip_prefix("data:") {
      let token = value.trim();
      if !token.is_empty() {
        out.push(token.to_string());
      }
    }
  }
  *buf = buf[last_nl + 1..].to_string();
  out
}

/// The SSE bridge body: GET the events URL and re-emit each `data:` token as the Tauri `change`
/// event, reusing the file-watcher's event name and "tasks"/"note" payloads so the frontend
/// handler is identical to local mode. Ends quietly on stream end or error (best-effort, like
/// the old `EventSource`); reconnect happens via the frontend's re-subscribe on settings change.
async fn run_sse(app: AppHandle, client: reqwest::Client, url: String) {
  let res = match client.get(&url).send().await {
    Ok(r) => r,
    Err(_) => return, // best-effort, like the file-watcher; reconnect via re-subscribe
  };
  let mut stream = res.bytes_stream();
  let mut buf = String::new();
  while let Some(chunk) = stream.next().await {
    let bytes = match chunk {
      Ok(b) => b,
      Err(_) => break,
    };
    buf.push_str(&String::from_utf8_lossy(&bytes));
    for token in sse_tokens(&mut buf) {
      let _ = app.emit(crate::watch::CHANGE_EVENT, token);
    }
  }
}

/// Abort the live SSE bridge task if one is running. Idempotent.
fn abort_sse(state: &AppState) -> Result<(), String> {
  if let Some(handle) = state.sse_task.lock().map_err(|e| e.to_string())?.take() {
    handle.abort();
  }
  Ok(())
}

/// Start (or restart) the SSE bridge to `url` (the absolute `/api/events` URL). Aborts any
/// existing bridge first, so a re-subscribe never leaks a task.
#[tauri::command]
pub async fn server_connect(
  app: AppHandle,
  state: State<'_, AppState>,
  url: String,
  allow_invalid_cert: bool,
) -> Result<(), String> {
  abort_sse(state.inner())?;
  let client = client_for(state.inner(), allow_invalid_cert)?;
  let handle = tauri::async_runtime::spawn(run_sse(app.clone(), client, url));
  *state.sse_task.lock().map_err(|e| e.to_string())? = Some(handle);
  Ok(())
}

/// Stop the live SSE bridge. Called from the frontend's `onChange` cleanup on disconnect.
#[tauri::command]
pub fn server_disconnect(state: State<'_, AppState>) -> Result<(), String> {
  abort_sse(state.inner())
}

#[cfg(test)]
mod tests {
  use super::sse_tokens;

  #[test]
  fn extracts_data_token_from_a_whole_frame() {
    let mut buf = "event: change\ndata: tasks\n\n".to_string();
    assert_eq!(sse_tokens(&mut buf), vec!["tasks".to_string()]);
    assert_eq!(buf, ""); // frame fully consumed
  }

  #[test]
  fn keeps_a_partial_trailing_line_until_its_newline_arrives() {
    let mut buf = "data: tas".to_string(); // split mid-token, no newline yet
    assert!(sse_tokens(&mut buf).is_empty());
    assert_eq!(buf, "data: tas");
    buf.push_str("ks\n\n"); // rest of the frame arrives
    assert_eq!(sse_tokens(&mut buf), vec!["tasks".to_string()]);
  }

  #[test]
  fn yields_multiple_tokens_from_one_read() {
    let mut buf = "data: tasks\n\ndata: note\n\n".to_string();
    assert_eq!(sse_tokens(&mut buf), vec!["tasks".to_string(), "note".to_string()]);
  }

  #[test]
  fn ignores_comment_event_and_empty_data_lines() {
    let mut buf = ": keep-alive\nevent: change\ndata:\n\n".to_string();
    assert!(sse_tokens(&mut buf).is_empty());
  }

  #[test]
  fn handles_crlf_line_endings() {
    let mut buf = "event: change\r\ndata: note\r\n\r\n".to_string();
    assert_eq!(sse_tokens(&mut buf), vec!["note".to_string()]);
  }
}
