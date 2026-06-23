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
/// revert to the default app-data directory. The stores are reloaded from the
/// new location immediately; any task IDs held by the frontend are invalidated.
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

  // Switch both stores before persisting config. Capture old paths so we can
  // roll the store back if the note switch fails — preventing a session where
  // todo.txt and Note.md are sourced from different directories.
  let old_todo = {
    let store = state.store.lock().map_err(lock_err)?;
    store.path().to_path_buf()
  };

  {
    let mut store = state.store.lock().map_err(lock_err)?;
    store
      .set_path(new_dir.join(paths::TODO_FILE))
      .map_err(|e| e.to_string())?;
  }

  {
    let mut note = state.note.lock().map_err(lock_err)?;
    if let Err(e) = note.set_path(new_dir.join(paths::NOTE_FILE)) {
      // Best-effort rollback: put the store back on its old path.
      if let Ok(mut store) = state.store.lock() {
        let _ = store.set_path(old_todo);
      }
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
