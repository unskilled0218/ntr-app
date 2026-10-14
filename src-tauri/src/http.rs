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
//! scoped Tauri `server-live` event. Local watcher events remain separate, so obsolete
//! connections and local backup writes cannot impersonate the current server.

use crate::state::{AppState, SseConnection};
use futures_util::StreamExt;
use std::time::Duration;
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
  fetch_response(&client, req, Duration::from_secs(30)).await
}

async fn fetch_response(
  client: &reqwest::Client,
  req: ServerRequest,
  read_timeout: Duration,
) -> Result<HttpResponse, String> {
  let method = reqwest::Method::from_bytes(req.method.as_bytes()).map_err(|e| e.to_string())?;
  let mut builder = client.request(method, &req.url);
  if req.method.eq_ignore_ascii_case("GET") {
    builder = builder.timeout(read_timeout);
  }
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

// Internal event only: the server API still emits its original string tokens.
const SERVER_LIVE_EVENT: &str = "server-live";
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LiveEvent {
  connection_id: String,
  kind: String,
}

#[derive(Clone, Copy)]
struct SseTiming {
  handshake: Duration,
  idle: Duration,
  healthy: Duration,
  retry: Duration,
  cap: Duration,
}

impl Default for SseTiming {
  fn default() -> Self {
    Self {
      handshake: Duration::from_secs(15),
      idle: Duration::from_secs(60),
      healthy: Duration::from_secs(30),
      retry: Duration::from_secs(1),
      cap: Duration::from_secs(30),
    }
  }
}

fn next_delay(delay: Duration, timing: SseTiming) -> Duration {
  delay.saturating_mul(2).min(timing.cap)
}

// Each attempt owns its buffer. Comments reset the idle deadline, even though
// they carry no resource change. Errors never log URLs, credentials, or bodies.
async fn sse_attempt(
  client: &reqwest::Client,
  url: &str,
  timing: SseTiming,
  emit: &(impl Fn(&str) + Sync),
) -> Result<(), String> {
  let response = tokio::time::timeout(timing.handshake, client.get(url).send())
    .await
    .map_err(|_| "SSE handshake timed out".to_string())?
    .map_err(|_| "SSE connection failed".to_string())?;
  if !response.status().is_success() {
    return Err(format!("SSE HTTP status {}", response.status()));
  }
  let content_type = response
    .headers()
    .get(reqwest::header::CONTENT_TYPE)
    .and_then(|value| value.to_str().ok())
    .unwrap_or("");
  if !content_type
    .split(';')
    .next()
    .unwrap_or("")
    .trim()
    .eq_ignore_ascii_case("text/event-stream")
  {
    return Err("SSE response has an invalid content type".to_string());
  }
  emit("connected");
  consume_stream(response.bytes_stream(), timing.idle, emit).await
}

async fn consume_stream<S, B, E>(
  mut stream: S,
  idle: Duration,
  emit: &(impl Fn(&str) + Sync),
) -> Result<(), String>
where
  S: futures_util::Stream<Item = Result<B, E>> + Unpin,
  B: AsRef<[u8]>,
{
  let mut buffer = String::new();
  loop {
    let chunk = tokio::time::timeout(idle, stream.next())
      .await
      .map_err(|_| "SSE stream idle deadline exceeded".to_string())?
      .ok_or_else(|| "SSE stream closed".to_string())?
      .map_err(|_| "SSE stream read failed".to_string())?;
    buffer.push_str(&String::from_utf8_lossy(chunk.as_ref()));
    for token in sse_tokens(&mut buffer) {
      if token == "tasks" || token == "note" {
        emit(&token);
      }
    }
    if buffer.len() > 65_536 {
      return Err("SSE line exceeds buffer limit".to_string());
    }
  }
}

// Aborting this single task cancels the request, idle wait, and retry sleep.
async fn run_sse(
  client: reqwest::Client,
  url: String,
  timing: SseTiming,
  emit: impl Fn(&str) + Send + Sync,
) {
  let mut delay = timing.retry;
  loop {
    let connected_at = std::sync::Mutex::new(None);
    let result = sse_attempt(&client, &url, timing, &|kind| {
      if kind == "connected" {
        *connected_at.lock().unwrap() = Some(tokio::time::Instant::now());
      }
      emit(kind);
    })
    .await;
    if connected_at
      .lock()
      .unwrap()
      .is_some_and(|at| at.elapsed() >= timing.healthy)
    {
      delay = timing.retry;
    }
    if let Err(error) = result {
      eprintln!("live sync: {error}; retrying");
    }
    tokio::time::sleep(delay).await;
    delay = next_delay(delay, timing);
  }
}

/// Start (or restart) the SSE bridge to `url` (the absolute `/api/events` URL). Aborts any
/// existing bridge atomically, so a re-subscribe never leaks a task. Disconnect
/// carries the caller's connection id and cannot abort a newer owner.
#[tauri::command]
pub async fn server_connect(
  app: AppHandle,
  state: State<'_, AppState>,
  url: String,
  allow_invalid_cert: bool,
  connection_id: String,
) -> Result<(), String> {
  let client = client_for(state.inner(), allow_invalid_cert)?;
  let mut slot = state.sse_task.lock().map_err(|e| e.to_string())?;
  let event_id = connection_id.clone();
  let task = tokio::spawn(run_sse(client, url, SseTiming::default(), move |kind| {
    let _ = app.emit(
      SERVER_LIVE_EVENT,
      LiveEvent {
        connection_id: event_id.clone(),
        kind: kind.to_string(),
      },
    );
  }));
  SseConnection::replace(
    &mut slot,
    SseConnection {
      id: connection_id,
      task,
    },
  );
  Ok(())
}

/// Stop the live SSE bridge. Called from the frontend's `onChange` cleanup on disconnect.
#[tauri::command]
pub fn server_disconnect(state: State<'_, AppState>, connection_id: String) -> Result<(), String> {
  let mut slot = state.sse_task.lock().map_err(|e| e.to_string())?;
  SseConnection::disconnect(&mut slot, &connection_id);
  Ok(())
}

#[cfg(test)]
#[path = "http_tests.rs"]
mod recovery_tests;

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
    assert_eq!(
      sse_tokens(&mut buf),
      vec!["tasks".to_string(), "note".to_string()]
    );
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
