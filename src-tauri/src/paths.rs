//! The one home for "where the local files live" and the two surviving config knobs.
//!
//! The server read these from environment variables (src/config.rs); a desktop/mobile app has
//! no env to configure, so the files live in Tauri's per-app data directory and the settings
//! that still matter are named constants here rather than magic literals inside a command body.

use std::io;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// todo.txt file name within the app data directory (server default `TODO_FILE`).
const TODO_FILE: &str = "todo.txt";
/// Markdown note file name within the app data directory (server default `NOTE_FILE`).
const NOTE_FILE: &str = "Note.md";

/// Stamp a creation date on new incomplete tasks that lack one (server default
/// `TODO_ADD_CREATION_DATE = true`). The one home for "do we stamp creation dates?".
pub const ADD_CREATION_DATE: bool = true;

/// Resolve the data directory, creating it on first run, and return the
/// `(todo.txt, Note.md)` paths inside it. A missing file is fine — the stores
/// treat it as empty (see `Store::load` / `NoteStore::load`).
pub fn data_files(app: &AppHandle) -> io::Result<(PathBuf, PathBuf)> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e.to_string()))?;
  std::fs::create_dir_all(&dir)?;
  Ok((dir.join(TODO_FILE), dir.join(NOTE_FILE)))
}
