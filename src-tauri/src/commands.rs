//! Tauri commands — the local replacement for the server's HTTP routes (src/api.rs).
//!
//! Each command is the thin shell the server's handler was: lock state, call the store/note
//! method, map errors to a `String` (the IPC error channel), and return the updated data.
//! Commands do NOT emit `change` events — the caller refreshes from the return value and the
//! file watcher is the single emitter (see plan.md "Single emitter").

use crate::backend::{self, FileBackend};
use crate::dto::TaskDto;
use crate::labelstore::Labels;
use crate::paths::{self, ADD_CREATION_DATE};
use crate::state::AppState;
use crate::store::{Filter, StoreError};
use chrono::{Local, NaiveDate};
use std::io;
use std::sync::Arc;
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

/// Copy one app data file between backends and remove the old copy. Missing
/// source files are a no-op, matching store load semantics.
fn move_backend_file(
  old_backend: &Arc<dyn FileBackend>,
  new_backend: &Arc<dyn FileBackend>,
  name: &str,
) -> io::Result<bool> {
  let Some(content) = old_backend.read(name)? else {
    return Ok(false);
  };
  new_backend.write(name, &content)?;
  old_backend.remove(name)?;
  Ok(true)
}

/// Undo backend file moves made by `set_data_dir` on error. Best-effort:
/// individual failures are ignored so the original error is not masked.
fn rollback_backend_moves(
  old_backend: &Arc<dyn FileBackend>,
  new_backend: &Arc<dyn FileBackend>,
  moved_todo: bool,
  moved_note: bool,
  moved_labels: bool,
) {
  for (moved, name) in [
    (moved_todo, paths::TODO_FILE),
    (moved_note, paths::NOTE_FILE),
    (moved_labels, paths::LABELS_FILE),
  ] {
    if moved {
      let _ = move_backend_file(new_backend, old_backend, name);
    }
  }
}

#[tauri::command]
pub fn list_tasks(
  state: State<'_, AppState>,
  completed: Option<bool>,
  priority: Option<serde_json::Value>,
  list: Option<String>,
  context: Option<String>,
) -> Result<Vec<TaskDto>, String> {
  reject_legacy_filter(priority.as_ref())?;
  let store = state.store.lock().map_err(lock_err)?;
  let filter = Filter {
    completed,
    list,
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

fn reject_legacy_filter(priority: Option<&serde_json::Value>) -> Result<(), String> {
  if priority.is_some_and(|value| !value.is_null()) {
    return Err("Priority filtering is no longer supported".into());
  }
  Ok(())
}

#[cfg(test)]
mod legacy_filter_tests {
  use super::*;

  #[test]
  fn accepts_omitted_and_null_but_rejects_every_non_null_value() {
    #[derive(serde::Deserialize)]
    struct Arguments {
      priority: Option<serde_json::Value>,
    }
    for json in ["{}", r#"{"priority":null}"#] {
      let args: Arguments = serde_json::from_str(json).unwrap();
      assert!(reject_legacy_filter(args.priority.as_ref()).is_ok());
    }
    for value in [
      serde_json::json!("A"),
      serde_json::json!(""),
      serde_json::json!("invalid"),
      serde_json::json!(false),
      serde_json::json!([]),
      serde_json::json!(1),
    ] {
      assert_eq!(
        reject_legacy_filter(Some(&value)).unwrap_err(),
        "Priority filtering is no longer supported"
      );
    }
  }
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

#[tauri::command]
pub fn get_labels(state: State<'_, AppState>) -> Result<Labels, String> {
  let labels = state.labels.lock().map_err(lock_err)?;
  Ok(labels.get())
}

#[tauri::command]
pub fn put_labels(state: State<'_, AppState>, labels: Labels) -> Result<(), String> {
  let mut store = state.labels.lock().map_err(lock_err)?;
  store.replace(labels).map_err(|e| e.to_string())
}

/// Return the display location currently used for todo.txt and Note.md.
#[tauri::command]
pub fn get_data_dir(app: AppHandle) -> Result<String, String> {
  let location = paths::resolve_data_dir(&app).map_err(|e| e.to_string())?;
  if backend::is_saf_location(&location) {
    backend::saf_display_name(&app, &location).map_err(|e| e.to_string())
  } else {
    Ok(location)
  }
}

#[tauri::command]
pub async fn pick_data_dir(app: AppHandle) -> Result<Option<String>, String> {
  #[cfg(target_os = "android")]
  {
    return backend::pick_saf_dir(&app).await.map_err(|e| e.to_string());
  }

  #[cfg(not(target_os = "android"))]
  {
    use tauri_plugin_dialog::DialogExt;

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
      let _ = tx.send(picked);
    });
    let picked = rx.await.map_err(|e| e.to_string())?;
    picked
      .map(|p| {
        p.into_path()
          .map(|path| path.to_string_lossy().into_owned())
      })
      .transpose()
      .map_err(|e| e.to_string())
  }
}

#[tauri::command]
pub fn storage_kind(_app: AppHandle) -> Result<&'static str, String> {
  #[cfg(target_os = "android")]
  {
    Ok("saf")
  }
  #[cfg(not(target_os = "android"))]
  {
    Ok("path")
  }
}

/// Set the directory used for todo.txt and Note.md. Pass an empty string to
/// revert to the default app-data directory. Existing files are moved to the
/// new location; stores are then reloaded from there. Any task IDs held by
/// the frontend are invalidated.
#[tauri::command]
pub fn set_data_dir(app: AppHandle, state: State<'_, AppState>, dir: String) -> Result<(), String> {
  let dir = dir.trim();

  let old_location = paths::resolve_data_dir(&app).map_err(|e| e.to_string())?;
  let new_location = if dir.is_empty() {
    paths::app_data_dir(&app)
      .map_err(|e| e.to_string())?
      .to_string_lossy()
      .into_owned()
  } else if backend::is_saf_location(dir) {
    dir.to_string()
  } else {
    let p = std::path::PathBuf::from(dir);
    if !p.is_absolute() {
      return Err("path must be absolute".to_string());
    }
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    p.to_string_lossy().into_owned()
  };

  let old_backend = backend::backend_for(&app, Some(&old_location)).map_err(|e| e.to_string())?;
  let new_backend = backend::backend_for(&app, Some(&new_location)).map_err(|e| e.to_string())?;

  let changed = old_location != new_location;
  let moved_todo = if changed {
    move_backend_file(&old_backend, &new_backend, paths::TODO_FILE).map_err(|e| e.to_string())?
  } else {
    false
  };
  let moved_note = if changed {
    match move_backend_file(&old_backend, &new_backend, paths::NOTE_FILE) {
      Ok(moved) => moved,
      Err(e) => {
        rollback_backend_moves(&old_backend, &new_backend, moved_todo, false, false);
        return Err(e.to_string());
      }
    }
  } else {
    false
  };
  let moved_labels = if changed {
    match move_backend_file(&old_backend, &new_backend, paths::LABELS_FILE) {
      Ok(moved) => moved,
      Err(e) => {
        rollback_backend_moves(&old_backend, &new_backend, moved_todo, moved_note, false);
        return Err(e.to_string());
      }
    }
  } else {
    false
  };

  // Switch both stores to read from the new backend. Rollback file moves on
  // store-switch failure so the session stays consistent.
  {
    let mut store = state.store.lock().map_err(lock_err)?;
    if let Err(e) = store.set_backend(new_backend.clone()) {
      rollback_backend_moves(
        &old_backend,
        &new_backend,
        moved_todo,
        moved_note,
        moved_labels,
      );
      return Err(e.to_string());
    }
  }

  {
    let mut note = state.note.lock().map_err(lock_err)?;
    if let Err(e) = note.set_backend(new_backend.clone()) {
      if let Ok(mut store) = state.store.lock() {
        let _ = store.set_backend(old_backend.clone());
      }
      rollback_backend_moves(
        &old_backend,
        &new_backend,
        moved_todo,
        moved_note,
        moved_labels,
      );
      return Err(e.to_string());
    }
  }

  {
    let mut labels = state.labels.lock().map_err(lock_err)?;
    if let Err(e) = labels.set_backend(new_backend.clone()) {
      if let Ok(mut store) = state.store.lock() {
        let _ = store.set_backend(old_backend.clone());
      }
      if let Ok(mut note) = state.note.lock() {
        let _ = note.set_backend(old_backend.clone());
      }
      rollback_backend_moves(
        &old_backend,
        &new_backend,
        moved_todo,
        moved_note,
        moved_labels,
      );
      return Err(e.to_string());
    }
  }

  if let Err(e) = paths::save_custom_data_dir(
    &app,
    if dir.is_empty() {
      None
    } else {
      Some(new_location.as_str())
    },
  ) {
    if let Ok(mut store) = state.store.lock() {
      let _ = store.set_backend(old_backend.clone());
    }
    if let Ok(mut note) = state.note.lock() {
      let _ = note.set_backend(old_backend.clone());
    }
    if let Ok(mut labels) = state.labels.lock() {
      let _ = labels.set_backend(old_backend.clone());
    }
    rollback_backend_moves(
      &old_backend,
      &new_backend,
      moved_todo,
      moved_note,
      moved_labels,
    );
    return Err(e.to_string());
  }

  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;
  fn temp_dir(tag: &str) -> std::path::PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("ntr-cmd-{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    p
  }

  #[test]
  fn move_backend_file_moves_content_and_removes_source() {
    let src: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("mv-src")));
    let dst: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("mv-dst")));
    src.write(paths::TODO_FILE, "hello").unwrap();

    assert!(move_backend_file(&src, &dst, paths::TODO_FILE).unwrap());

    assert_eq!(
      dst.read(paths::TODO_FILE).unwrap().as_deref(),
      Some("hello")
    );
    assert!(src.read(paths::TODO_FILE).unwrap().is_none());
  }

  #[test]
  fn move_backend_file_overwrites_existing_destination() {
    let src: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("mv-ow-src")));
    let dst: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("mv-ow-dst")));
    src.write(paths::TODO_FILE, "new").unwrap();
    dst.write(paths::TODO_FILE, "old").unwrap();

    assert!(move_backend_file(&src, &dst, paths::TODO_FILE).unwrap());

    assert_eq!(dst.read(paths::TODO_FILE).unwrap().as_deref(), Some("new"));
    assert!(src.read(paths::TODO_FILE).unwrap().is_none());
  }

  #[test]
  fn rollback_restores_all_moved_resources() {
    let src: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("rb-src")));
    let dst: Arc<dyn FileBackend> = Arc::new(crate::backend::FsBackend::new(temp_dir("rb-dst")));
    for (name, content) in [
      (paths::TODO_FILE, "task"),
      (paths::NOTE_FILE, "note"),
      (paths::LABELS_FILE, "labels"),
    ] {
      dst.write(name, content).unwrap();
    }

    rollback_backend_moves(&src, &dst, true, true, true);

    for (name, content) in [
      (paths::TODO_FILE, "task"),
      (paths::NOTE_FILE, "note"),
      (paths::LABELS_FILE, "labels"),
    ] {
      assert_eq!(src.read(name).unwrap().as_deref(), Some(content));
      assert!(dst.read(name).unwrap().is_none());
    }
  }
}
