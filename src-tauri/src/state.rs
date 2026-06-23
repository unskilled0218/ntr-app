//! Shared application state: the task store and the note store, each behind a `Mutex`.
//!
//! The server used `RwLock` for HTTP concurrency; here commands are short and low-contention,
//! so a `Mutex` is simpler and sufficient. Both stores keep the server's write-then-swap
//! discipline, so the file and memory never diverge.

use crate::note::NoteStore;
use crate::store::Store;
use std::sync::Mutex;

pub struct AppState {
  pub store: Mutex<Store>,
  pub note: Mutex<NoteStore>,
}

impl AppState {
  pub fn new(store: Store, note: NoteStore) -> Self {
    AppState {
      store: Mutex::new(store),
      note: Mutex::new(note),
    }
  }
}
