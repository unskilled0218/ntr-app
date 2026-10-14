//! Shared application state: the task store and the note store, each behind a `Mutex`.
//!
//! The server used `RwLock` for HTTP concurrency; here commands are short and low-contention,
//! so a `Mutex` is simpler and sufficient. Both stores keep the server's write-then-swap
//! discipline, so the file and memory never diverge.

use crate::labelstore::LabelStore;
use crate::note::NoteStore;
use crate::store::Store;
use std::sync::Mutex;
use tokio::task::JoinHandle;

pub struct SseConnection {
  pub id: String,
  pub task: JoinHandle<()>,
}

impl SseConnection {
  pub fn replace(slot: &mut Option<Self>, connection: Self) {
    if let Some(previous) = slot.replace(connection) {
      previous.task.abort();
    }
  }

  pub fn disconnect(slot: &mut Option<Self>, id: &str) {
    if slot.as_ref().is_some_and(|connection| connection.id == id) {
      if let Some(connection) = slot.take() {
        connection.task.abort();
      }
    }
  }
}

pub struct AppState {
  pub store: Mutex<Store>,
  pub note: Mutex<NoteStore>,
  pub labels: Mutex<LabelStore>,
  /// Cached server-mode HTTP client + the cert policy it was built with. A reqwest client owns
  /// a connection pool and is meant to be reused, not rebuilt per call; the `bool` is the cache
  /// key — rebuilt only when `allow_invalid_cert` flips. `None` until the first server request.
  pub http_client: Mutex<Option<(bool, reqwest::Client)>>,
  /// The live SSE bridge task (server mode). `server_connect` spawns it; `server_disconnect`
  /// (and a re-connect) aborts it. `None` when in local mode or not yet connected.
  pub sse_task: Mutex<Option<SseConnection>>,
}

impl AppState {
  pub fn new(store: Store, note: NoteStore, labels: LabelStore) -> Self {
    AppState {
      store: Mutex::new(store),
      note: Mutex::new(note),
      labels: Mutex::new(labels),
      http_client: Mutex::new(None),
      sse_task: Mutex::new(None),
    }
  }
}
