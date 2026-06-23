//! Tauri commands — the local replacement for the server's HTTP routes (src/api.rs).
//!
//! Each command is the thin shell the server's handler was: lock state, call the store/note
//! method, map errors to a `String` (the IPC error channel), and return the updated data.
//! Commands do NOT emit `change` events — the caller refreshes from the return value and the
//! file watcher is the single emitter (see plan.md "Single emitter").

use crate::dto::TaskDto;
use crate::paths::{self, ADD_CREATION_DATE};
use crate::state::AppState;
use crate::store::{Filter, StoreError};
use chrono::{Local, NaiveDate};
use std::io;
use std::path::Path;
use tauri::{AppHandle, State};

/// Today in the local timezone, matching the server's `today()`.
fn today() -> NaiveDate {
  Local::now().date_naive()
}

/// Map a store error to the user-facing message the server's API produced.
fn store_err(e: StoreError) -> String {
  match e {
    StoreError::NotFound => "not found".to_string(),
    StoreError::Invalid(m) => m,
    StoreError::Io(e) => e.to_string(),
  }
}

/// The poisoned-lock message, mirroring the server's `lock_err`.
fn lock_err<E>(_: E) -> String {
  "store lock poisoned".to_string()
}

/// Undo file moves made by `set_data_dir` on error. Best-effort: individual
/// failures are ignored so the original error is not masked.
fn rollback_moves(
  moved_todo: bool,
  new_todo: &Path,
  old_todo: &Path,
  moved_note: bool,
  new_note: &Path,
  old_note: &Path,
) {
  if moved_todo {
    let _ = move_file(new_todo, old_todo);
  }
  if moved_note {
    let _ = move_file(new_note, old_note);
  }
}

/// Move `from` to `to`, overwriting `to` if it exists. The caller is the one
/// who has decided to overwrite: the user explicitly requested a path change,
/// so their current data takes precedence over any pre-existing file at the
/// destination.
///
/// On the same filesystem `fs::rename` is atomic. Across filesystems (EXDEV)
/// we fall back to copy + delete; the window between the two is not atomic,
/// but for a user-triggered settings action this is acceptable.
///
/// Known limitation: if a forward move succeeds and its rollback in the caller
/// also fails (e.g. the file is removed by a concurrent process in the ~10 ms
/// between the two calls), the file is lost. The probability is negligible for
/// an interactive settings operation.
fn move_file(from: &Path, to: &Path) -> io::Result<()> {
  match std::fs::rename(from, to) {
    Ok(()) => Ok(()),
    Err(e) if e.kind() == io::ErrorKind::CrossesDevices => {
      std::fs::copy(from, to)?;
      std::fs::remove_file(from)
    }
    Err(e) => Err(e),
  }
}

#[tauri::command]
pub fn list_tasks(
  state: State<'_, AppState>,
  completed: Option<bool>,
  priority: Option<char>,
  project: Option<String>,
  context: Option<String>,
) -> Result<Vec<TaskDto>, String> {
  let store = state.store.lock().map_err(lock_err)?;
  let filter = Filter {
    completed,
    priority,
    project,
    context,
  };
  Ok(
    store
      .list(&filter)
      .into_iter()
      .map(TaskDto::from_entry)
      .collect(),
  )
}

#[tauri::command]
pub fn create_task(state: State<'_, AppState>, text: String) -> Result<TaskDto, String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  let id = store
    .add(&text, ADD_CREATION_DATE, today())
    .map_err(store_err)?;
  Ok(TaskDto::from_entry(
    store.get(id).expect("task was just added"),
  ))
}

#[tauri::command]
pub fn get_task(state: State<'_, AppState>, id: u64) -> Result<TaskDto, String> {
  let store = state.store.lock().map_err(lock_err)?;
  let entry = store.get(id).ok_or("not found")?;
  Ok(TaskDto::from_entry(entry))
}

#[tauri::command]
pub fn update_task(state: State<'_, AppState>, id: u64, text: String) -> Result<TaskDto, String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  store.update(id, &text).map_err(store_err)?;
  Ok(TaskDto::from_entry(store.get(id).expect("task exists")))
}

#[tauri::command]
pub fn complete_task(state: State<'_, AppState>, id: u64) -> Result<TaskDto, String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  store.complete(id, today()).map_err(store_err)?;
  Ok(TaskDto::from_entry(store.get(id).expect("task exists")))
}

#[tauri::command]
pub fn uncomplete_task(state: State<'_, AppState>, id: u64) -> Result<TaskDto, String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  store.uncomplete(id).map_err(store_err)?;
  Ok(TaskDto::from_entry(store.get(id).expect("task exists")))
}

#[tauri::command]
pub fn delete_task(state: State<'_, AppState>, id: u64) -> Result<(), String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  store.delete(id).map_err(store_err)
}

#[tauri::command]
pub fn get_raw(state: State<'_, AppState>) -> Result<String, String> {
  let store = state.store.lock().map_err(lock_err)?;
  Ok(store.raw())
}

#[tauri::command]
pub fn put_raw(state: State<'_, AppState>, text: String) -> Result<(), String> {
  let mut store = state.store.lock().map_err(lock_err)?;
  store.replace_raw(&text).map_err(store_err)
}

#[tauri::command]
pub fn get_note(state: State<'_, AppState>) -> Result<String, String> {
  let note = state.note.lock().map_err(lock_err)?;
  Ok(note.content().to_string())
}

#[tauri::command]
pub fn put_note(state: State<'_, AppState>, text: String) -> Result<(), String> {
  let mut note = state.note.lock().map_err(lock_err)?;
  note.replace(&text).map_err(|e| e.to_string())
}

/// Return the absolute path of the directory currently used for todo.txt and Note.md.
#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> Result<String, String> {
  paths::resolve_data_dir(&app)
    .map(|p| p.to_string_lossy().into_owned())
    .map_err(|e| e.to_string())
}

/// Set the directory used for todo.txt and Note.md. Pass an empty string to
/// revert to the default app-data directory. Existing files are moved to the
/// new location; stores are then reloaded from there. Any task IDs held by
/// the frontend are invalidated.
#[tauri::command]
pub fn set_data_dir(
  app: AppHandle,
  state: State<'_, AppState>,
  dir: String,
) -> Result<(), String> {
  let dir = dir.trim();

  let new_dir = if dir.is_empty() {
    paths::app_data_dir(&app).map_err(|e| e.to_string())?
  } else {
    let p = std::path::PathBuf::from(dir);
    if !p.is_absolute() {
      return Err("path must be absolute".to_string());
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    p
  };

  // Both files always share the same parent directory by construction
  // (see paths::data_files). Derive the note's old path from the store's path
  // so we avoid adding a path() getter to NoteStore for a single caller.
  let old_todo = {
    let store = state.store.lock().map_err(lock_err)?;
    store.path().to_path_buf()
  };
  let old_note = old_todo
    .parent()
    .ok_or("data directory has no parent")?
    .join(paths::NOTE_FILE);

  let new_todo = new_dir.join(paths::TODO_FILE);
  let new_note = new_dir.join(paths::NOTE_FILE);

  // Move files before switching stores. Only move when the path actually
  // changes and the source file exists; absent files are a no-op (stores
  // already treat missing files as empty).
  let moved_todo = old_todo != new_todo && old_todo.exists();
  let moved_note = old_note != new_note && old_note.exists();

  if moved_todo {
    move_file(&old_todo, &new_todo).map_err(|e| e.to_string())?;
  }
  if moved_note {
    if let Err(e) = move_file(&old_note, &new_note) {
      rollback_moves(moved_todo, &new_todo, &old_todo, false, &new_note, &old_note);
      return Err(e.to_string());
    }
  }

  // Switch both stores to read from the new paths. Rollback file moves on
  // store-switch failure so the session stays consistent.
  {
    let mut store = state.store.lock().map_err(lock_err)?;
    if let Err(e) = store.set_path(new_todo.clone()) {
      rollback_moves(moved_todo, &new_todo, &old_todo, moved_note, &new_note, &old_note);
      return Err(e.to_string());
    }
  }

  {
    let mut note = state.note.lock().map_err(lock_err)?;
    if let Err(e) = note.set_path(new_note.clone()) {
      if let Ok(mut store) = state.store.lock() {
        let _ = store.set_path(old_todo.clone());
      }
      rollback_moves(moved_todo, &new_todo, &old_todo, moved_note, &new_note, &old_note);
      return Err(e.to_string());
    }
  }

  let custom = if dir.is_empty() {
    None
  } else {
    Some(new_dir.as_path())
  };
  paths::save_custom_data_dir(&app, custom).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn temp_path(tag: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("ntr-cmd-{}-{}", tag, std::process::id()));
    p
  }

  #[test]
  fn move_file_moves_content_and_removes_source() {
    let src = temp_path("mv-src.txt");
    let dst = temp_path("mv-dst.txt");
    fs::write(&src, "hello").unwrap();
    let _ = fs::remove_file(&dst);

    move_file(&src, &dst).unwrap();

    assert_eq!(fs::read_to_string(&dst).unwrap(), "hello");
    assert!(!src.exists());
  }

  #[test]
  fn move_file_overwrites_existing_destination() {
    let src = temp_path("mv-ow-src.txt");
    let dst = temp_path("mv-ow-dst.txt");
    fs::write(&src, "new").unwrap();
    fs::write(&dst, "old").unwrap();

    move_file(&src, &dst).unwrap();

    assert_eq!(fs::read_to_string(&dst).unwrap(), "new");
    assert!(!src.exists());
  }
}
