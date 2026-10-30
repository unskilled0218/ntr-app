use super::*;
use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

fn get_request(url: String) -> ServerRequest {
  ServerRequest { url, method: "GET".into(), body: None, content_type: None, allow_invalid_cert: false, client_id: None }
}

#[tokio::test]
async fn ordinary_connection_errors_are_typed_and_keep_the_ipc_message() {
  let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  drop(listener);
  let error = fetch_response(&reqwest::Client::new(), get_request(format!("http://{address}/api/note")), Duration::from_millis(50)).await.unwrap_err();
  let serialized = serde_json::to_value(&error).unwrap();
  assert_eq!(serialized["kind"], "connection");
  assert!(serialized["message"].as_str().unwrap().contains("error sending request"));
}

#[tokio::test]
async fn ordinary_get_timeout_is_connection_failure_but_bad_url_and_http_status_are_not() {
  let fixture = fixture_at("127.0.0.1:0", vec![""]).await;
  let client = reqwest::Client::new();
  let error = fetch_response(&client, get_request(format!("http://{}/api/note", fixture.address)), Duration::from_millis(10)).await.unwrap_err();
  assert_eq!(error.kind, "connection");
  let error = fetch_response(&client, get_request("not a URL".into()), Duration::from_millis(10)).await.unwrap_err();
  assert_eq!(error.kind, "request");
  let fixture = fixture_at("127.0.0.1:0", vec!["HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n"]).await;
  let response = fetch_response(&client, get_request(format!("http://{}/api/note", fixture.address)), Duration::from_secs(1)).await.unwrap();
  assert_eq!(response.status, 503);
  assert!(!response.ok);
}

struct Fixture {
  address: SocketAddr,
  task: JoinHandle<()>,
}

impl Drop for Fixture {
  fn drop(&mut self) {
    self.task.abort();
  }
}

async fn fixture_at(address: &str, responses: Vec<&'static str>) -> Fixture {
  let listener = TcpListener::bind(address).await.unwrap();
  let address = listener.local_addr().unwrap();
  let task = tokio::spawn(async move {
    for response in responses {
      let (mut socket, _) = listener.accept().await.unwrap();
      read_headers(&mut socket).await;
      if response.is_empty() {
        std::future::pending::<()>().await;
      }
      socket.write_all(response.as_bytes()).await.unwrap();
      socket.shutdown().await.unwrap();
    }
  });
  Fixture { address, task }
}

async fn read_headers(socket: &mut tokio::net::TcpStream) {
  let mut request = Vec::new();
  while !request.ends_with(b"\r\n\r\n") {
    let mut byte = [0];
    socket.read_exact(&mut byte).await.unwrap();
    request.push(byte[0]);
    assert!(request.len() < 4096, "fixture request headers too large");
  }
}

#[tokio::test]
async fn client_id_is_forwarded_on_mutations_and_the_sse_handshake() {
  let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  let server = tokio::spawn(async move {
    for sse in [false, true] {
      let (mut socket, _) = listener.accept().await.unwrap();
      let mut request = Vec::new();
      while !request.ends_with(b"\r\n\r\n") {
        let mut byte = [0];
        socket.read_exact(&mut byte).await.unwrap();
        request.push(byte[0]);
      }
      let request = String::from_utf8(request).unwrap().to_lowercase();
      assert!(request.contains("x-ntr-client-id: client-session\r\n"));
      let response = if sse {
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: tasks\n\n"
      } else {
        "HTTP/1.1 204 No Content\r\nConnection: close\r\n\r\n"
      };
      socket.write_all(response.as_bytes()).await.unwrap();
    }
  });
  let client = reqwest::Client::new();
  let response = fetch_response(
    &client,
    ServerRequest {
      url: format!("http://{address}/api/note"),
      method: "PUT".into(),
      body: Some("note".into()),
      content_type: Some("text/plain".into()),
      allow_invalid_cert: false,
      client_id: Some("client-session".into()),
    },
    Duration::from_secs(1),
  )
  .await
  .unwrap();
  assert!(response.ok);
  let delivered = std::sync::Mutex::new(Vec::new());
  let _ = sse_attempt(
    &client,
    &format!("http://{address}/api/events"),
    Some("client-session"),
    timing(),
    &|kind| {
      delivered.lock().unwrap().push(kind.to_string());
    },
  )
  .await;
  server.await.unwrap();
  assert_eq!(*delivered.lock().unwrap(), ["connected", "tasks"]);
}

#[tokio::test]
async fn idle_deadline_enters_the_reconnect_loop_without_eof() {
  let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  let fixture = Fixture {
    address,
    task: tokio::spawn(async move {
      let mut held = Vec::new();
      for attempt in 0..2 {
        let (mut socket, _) = listener.accept().await.unwrap();
        read_headers(&mut socket).await;
        socket
          .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\n\r\n")
          .await
          .unwrap();
        if attempt == 1 {
          socket.write_all(b"data: note\n\n").await.unwrap();
        }
        held.push(socket); // first socket stays open but silent
      }
      std::future::pending::<()>().await;
      drop(held);
    }),
  };
  let (task, mut rx) = bridge(fixture.address, timing());
  assert_eq!(events(&mut rx, 3).await, ["connected", "connected", "note"]);
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

fn timing() -> SseTiming {
  SseTiming {
    handshake: Duration::from_millis(100),
    idle: Duration::from_millis(100),
    healthy: Duration::from_millis(200),
    retry: Duration::from_millis(30),
    cap: Duration::from_millis(100),
  }
}

async fn events(rx: &mut mpsc::UnboundedReceiver<String>, count: usize) -> Vec<String> {
  tokio::time::timeout(Duration::from_secs(3), async {
    let mut result = Vec::new();
    for _ in 0..count {
      result.push(rx.recv().await.unwrap());
    }
    result
  })
  .await
  .expect("bridge did not recover")
}

fn bridge(
  address: SocketAddr,
  timing: SseTiming,
) -> (JoinHandle<()>, mpsc::UnboundedReceiver<String>) {
  let (tx, rx) = mpsc::unbounded_channel();
  let task = tokio::spawn(run_sse(
    reqwest::Client::new(),
    format!("http://{address}/api/events"),
    None,
    timing,
    move |kind| {
      let _ = tx.send(kind.to_string());
    },
  ));
  (task, rx)
}

#[tokio::test]
async fn rejects_http_and_content_type_then_recovers_and_delivers_both_resources() {
  let fixture = fixture_at("127.0.0.1:0", vec![
    "HTTP/1.1 503 Unavailable\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: tasks\n\n",
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\ndata: note\n\n",
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream; charset=utf-8\r\nConnection: close\r\n\r\ndata: tasks\n\ndata: note\n\n",
  ]).await;
  let (task, mut rx) = bridge(fixture.address, timing());
  assert_eq!(events(&mut rx, 3).await, ["connected", "tasks", "note"]);
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn refused_connection_recovers_when_the_server_starts() {
  let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  drop(listener);
  let (task, mut rx) = bridge(address, timing());
  tokio::time::sleep(Duration::from_millis(50)).await;
  assert!(rx.try_recv().is_err());
  let _fixture = fixture_at(
    &address.to_string(),
    vec![
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: note\n\n",
  ],
  )
  .await;
  assert_eq!(events(&mut rx, 2).await, ["connected", "note"]);
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn eof_reconnects_and_does_not_join_partial_tokens_across_connections() {
  let fixture = fixture_at("127.0.0.1:0", vec![
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: tas",
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\nks\n\ndata: note\n\n",
  ]).await;
  let (task, mut rx) = bridge(fixture.address, timing());
  assert_eq!(events(&mut rx, 3).await, ["connected", "connected", "note"]);
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn truncated_stream_recovers_after_a_read_error() {
  let fixture = fixture_at("127.0.0.1:0", vec![
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 1000\r\n\r\n: heartbeat\n\n",
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: tasks\n\n",
  ]).await;
  let (task, mut rx) = bridge(fixture.address, timing());
  assert_eq!(
    events(&mut rx, 3).await,
    ["connected", "connected", "tasks"]
  );
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test]
async fn handshake_and_ordinary_get_have_finite_deadlines() {
  let fixture = fixture_at("127.0.0.1:0", vec![""]).await;
  let url = format!("http://{}/api/events", fixture.address);
  let client = reqwest::Client::new();
  let result = sse_attempt(&client, &url, None, timing(), &|_| {
    panic!("not an accepted stream")
  })
  .await;
  assert_eq!(result.unwrap_err(), "SSE handshake timed out");
  let response = fetch_response(
    &client,
    ServerRequest {
      url,
      method: "GET".to_string(),
      body: None,
      content_type: None,
      allow_invalid_cert: false,
      client_id: None,
    },
    Duration::from_millis(100),
  )
  .await;
  assert!(response.is_err());
}

#[tokio::test(start_paused = true)]
async fn silent_stream_times_out_and_comment_heartbeats_keep_it_alive() {
  let idle = Duration::from_secs(60);
  let silent = futures_util::stream::pending::<Result<Vec<u8>, ()>>();
  let error = consume_stream(silent, idle, &|_| panic!("silent stream emitted a change"))
    .await
    .unwrap_err();
  assert_eq!(error, "SSE stream idle deadline exceeded");

  let comments = Box::pin(futures_util::stream::unfold(0, |count| async move {
    if count == 10 {
      return None;
    }
    tokio::time::sleep(Duration::from_secs(15)).await;
    Some((Ok::<_, ()>(b": keep-alive\n\n".to_vec()), count + 1))
  }));
  let error = consume_stream(comments, idle, &|_| panic!("heartbeat emitted a change"))
    .await
    .unwrap_err();
  assert_eq!(error, "SSE stream closed"); // survived 150 seconds, not a total timeout
}

#[tokio::test(start_paused = true)]
async fn split_tokens_are_decoded_and_unknown_tokens_are_ignored() {
  let output = std::sync::Mutex::new(Vec::new());
  let chunks = futures_util::stream::iter([
    Ok::<_, ()>(b"data: tas".to_vec()),
    Ok(b"ks\n\ndata: note\n\ndata: unknown\n\n".to_vec()),
  ]);
  let error = consume_stream(chunks, Duration::from_secs(60), &|kind| {
    output.lock().unwrap().push(kind.to_string());
  })
  .await
  .unwrap_err();
  assert_eq!(error, "SSE stream closed");
  assert_eq!(*output.lock().unwrap(), ["tasks", "note"]);
}

#[tokio::test]
async fn cancellation_stops_a_pending_handshake_and_retry_sleep() {
  let fixture = fixture_at("127.0.0.1:0", vec![""]).await;
  let (task, mut rx) = bridge(fixture.address, timing());
  tokio::time::sleep(Duration::from_millis(20)).await;
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
  assert!(rx.try_recv().is_err());

  let failed = fixture_at(
    "127.0.0.1:0",
    vec!["HTTP/1.1 503 Unavailable\r\nContent-Length: 0\r\n\r\n"],
  )
  .await;
  let mut slow_retry = timing();
  slow_retry.retry = Duration::from_secs(60);
  let (task, _) = bridge(failed.address, slow_retry);
  tokio::time::sleep(Duration::from_millis(30)).await;
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[tokio::test(start_paused = true)]
async fn cancellation_stops_an_idle_stream_wait() {
  let task = tokio::spawn(async {
    consume_stream(
      futures_util::stream::pending::<Result<Vec<u8>, ()>>(),
      Duration::from_secs(60),
      &|_| {},
    )
    .await
  });
  tokio::task::yield_now().await;
  task.abort();
  assert!(task.await.unwrap_err().is_cancelled());
}

#[test]
fn backoff_is_bounded() {
  let timing = SseTiming::default();
  let mut delay = timing.retry;
  let mut seconds = vec![delay.as_secs()];
  for _ in 0..7 {
    delay = next_delay(delay, timing);
    seconds.push(delay.as_secs());
  }
  assert_eq!(seconds, [1, 2, 4, 8, 16, 30, 30, 30]);
}

#[tokio::test]
async fn replacing_connection_aborts_the_old_owner_and_stale_cleanup_leaves_new_owner() {
  let (old_done, old_rx) = tokio::sync::oneshot::channel::<()>();
  let old = tokio::spawn(async move {
    let _ = old_rx.await;
  });
  let mut slot = Some(SseConnection {
    id: "A".into(),
    task: old,
  });
  let new = tokio::spawn(std::future::pending::<()>());
  SseConnection::replace(
    &mut slot,
    SseConnection {
      id: "B".into(),
      task: new,
    },
  );
  tokio::task::yield_now().await;
  assert!(old_done.is_closed());
  SseConnection::disconnect(&mut slot, "A");
  assert_eq!(slot.as_ref().unwrap().id, "B");
  assert!(!slot.as_ref().unwrap().task.is_finished());
  SseConnection::disconnect(&mut slot, "B");
  assert!(slot.is_none());
  SseConnection::disconnect(&mut slot, "B");
}

// Opt-in integration with the unchanged server binary. The ordinary suite stays
// self-contained; this test runs two independent native bridges, not a mock SSE client.
#[tokio::test]
#[ignore = "requires MY_NTR_SERVER_BIN pointing to the built ntr server"]
async fn two_clients_sync_and_recover_missed_files_after_real_server_restart() {
  use std::path::PathBuf;
  use std::process::{Child, Command, Stdio};

  struct Server {
    binary: PathBuf,
    directory: PathBuf,
    address: SocketAddr,
    process: Option<Child>,
  }
  impl Server {
    fn start(&mut self) {
      self.process = Some(
        Command::new(&self.binary)
          .env("HOST", "127.0.0.1")
          .env("PORT", self.address.port().to_string())
          .env("TODO_FILE", self.directory.join("todo.txt"))
          .env("NOTE_FILE", self.directory.join("Note.md"))
          .env("LABELS_FILE", self.directory.join("labels.json"))
          .stdout(Stdio::null())
          .stderr(Stdio::null())
          .spawn()
          .unwrap(),
      );
    }
    fn stop(&mut self) {
      if let Some(mut child) = self.process.take() {
        let _ = child.kill();
        child.wait().unwrap();
      }
    }
  }
  impl Drop for Server {
    fn drop(&mut self) {
      self.stop();
      std::fs::remove_dir_all(&self.directory).unwrap();
    }
  }
  struct Client {
    task: JoinHandle<()>,
    events: mpsc::UnboundedReceiver<String>,
    http: reqwest::Client,
  }
  impl Drop for Client {
    fn drop(&mut self) {
      self.task.abort();
    }
  }
  async fn ready(client: &reqwest::Client, url: &str) {
    tokio::time::timeout(Duration::from_secs(5), async {
      loop {
        if client.get(format!("{url}/api/health")).send().await.is_ok() {
          return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
      }
    })
    .await
    .expect("real server failed to start");
  }
  async fn put(client: &reqwest::Client, url: &str, resource: &str, text: &str) {
    client
      .put(format!("{url}/api/{resource}"))
      .header("content-type", "text/plain")
      .body(text.to_string())
      .send()
      .await
      .unwrap()
      .error_for_status()
      .unwrap();
  }

  let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
  let address = listener.local_addr().unwrap();
  drop(listener);
  let unique = std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .unwrap()
    .as_nanos();
  let directory = std::env::temp_dir().join(format!("ntr-live-{}-{unique}", std::process::id()));
  std::fs::create_dir(&directory).unwrap();
  let mut server = Server {
    binary: PathBuf::from(std::env::var("MY_NTR_SERVER_BIN").expect("set MY_NTR_SERVER_BIN")),
    directory,
    address,
    process: None,
  };
  server.start();
  let url = format!("http://{address}");
  let http_a = reqwest::Client::new();
  ready(&http_a, &url).await;
  let (task, receiver) = bridge(address, SseTiming::default());
  let mut a = Client {
    task,
    events: receiver,
    http: http_a,
  };
  let (task, receiver) = bridge(address, SseTiming::default());
  let mut b = Client {
    task,
    events: receiver,
    http: reqwest::Client::new(),
  };
  assert_eq!(events(&mut a.events, 1).await, ["connected"]);
  assert_eq!(events(&mut b.events, 1).await, ["connected"]);

  for (client, resource, text, kind) in [
    (&a.http, "raw", "from A\n", "tasks"),
    (&b.http, "note", "note from B", "note"),
    (&b.http, "raw", "from B\n", "tasks"),
    (&a.http, "note", "note from A", "note"),
  ] {
    put(client, &url, resource, text).await;
    assert_eq!(events(&mut a.events, 1).await, [kind]);
    assert_eq!(events(&mut b.events, 1).await, [kind]);
  }
  tokio::join!(
    put(&a.http, &url, "raw", "nearby task\n"),
    put(&b.http, &url, "note", "nearby note")
  );
  for receiver in [&mut a.events, &mut b.events] {
    let mut received = events(receiver, 2).await;
    received.sort();
    assert_eq!(received, ["note", "tasks"]);
  }

  server.stop();
  std::fs::write(server.directory.join("todo.txt"), "missed task\n").unwrap();
  std::fs::write(server.directory.join("Note.md"), "missed note").unwrap();
  server.start();
  ready(&a.http, &url).await;
  for client in [&mut a, &mut b] {
    assert_eq!(events(&mut client.events, 1).await, ["connected"]);
    for (resource, expected) in [("raw", "missed task\n"), ("note", "missed note")] {
      let text = client
        .http
        .get(format!("{url}/api/{resource}"))
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
      assert_eq!(text, expected);
    }
    assert!(client.events.try_recv().is_err()); // no later mutation was needed
  }
}
