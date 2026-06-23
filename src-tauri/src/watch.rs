//! Live updates: the single emitter of `change` events.
//!
//! Ported from my-ntr-server src/watch.rs + the SSE half of src/api.rs. The server polled the
//! files every second and announced out-of-band edits to connected clients; here a background
//! task does the same and `emit`s a Tauri `change` event to the frontend. Commands deliberately
//! do NOT emit (see plan.md "Single emitter"): the caller refreshes from a command's own return
//! value, and a command's own write leaves disk == memory so `reload_from_disk` stays silent for
//! it. This watcher is only for edits made to the files behind the app's back.

use crate::state::AppState;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

/// The live-update event name the frontend listens for.
pub const CHANGE_EVENT: &str = "change";

/// Which resource changed. `as_str` is the wire payload; the TS side mirrors these two strings
/// as `CHANGE_TASKS` / `CHANGE_NOTE` in src/api.ts — keep the two ends in sync.
#[derive(Debug, Clone, Copy)]
pub enum Change {
  Tasks,
  Note,
}

impl Change {
  fn as_str(self) -> &'static str {
    match self {
      Change::Tasks => "tasks",
      Change::Note => "note",
    }
  }
}

/// How often the watcher re-reads the files to pick up out-of-band edits. Matches the server's
/// 1s poll: tiny files make it cheap and it bounds how long a change takes to appear.
const WATCH_INTERVAL: Duration = Duration::from_secs(1);

/// Spawn the background poll loop. Each tick reloads both stores from disk and, when a real
/// (non-whitespace) change is detected, emits the matching `change` event.
pub fn spawn(app: AppHandle) {
  tauri::async_runtime::spawn(async move {
    loop {
      tokio::time::sleep(WATCH_INTERVAL).await;

      // Reload both stores inside a scope, capturing whether each changed, so the guards and the
      // borrowed state handle are released before emitting — no lock is held across `app.emit`.
      let (tasks_changed, note_changed) = {
        let state = app.state::<AppState>();
        let tasks_changed = match state.store.lock() {
          Ok(mut store) => matches!(store.reload_from_disk(), Ok(true)),
          Err(_) => false,
        };
        let note_changed = match state.note.lock() {
          Ok(mut note) => matches!(note.reload_from_disk(), Ok(true)),
          Err(_) => false,
        };
        (tasks_changed, note_changed)
      };

      if tasks_changed {
        let _ = app.emit(CHANGE_EVENT, Change::Tasks.as_str());
      }
      if note_changed {
        let _ = app.emit(CHANGE_EVENT, Change::Note.as_str());
      }
    }
  });
}
