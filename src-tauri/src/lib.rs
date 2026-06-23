//! my-ntr Tauri client: a local-first todo.txt + Markdown-note app that reproduces the
//! my-ntr-server WebUI, backed by local files instead of an HTTP server.

mod atomicfile;
mod commands;
mod dto;
mod note;
mod paths;
mod state;
mod store;
mod task;
mod watch;

use note::NoteStore;
use state::AppState;
use store::Store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .setup(|app| {
      // Resolve the local data files, load both stores, and make them shared state.
      let (todo_path, note_path) = paths::data_files(app.handle())?;
      let store = Store::load(&todo_path)?;
      let note = NoteStore::load(&note_path)?;
      app.manage(AppState::new(store, note));

      // The watcher is the single emitter of live-update `change` events.
      watch::spawn(app.handle().clone());
      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      commands::list_tasks,
      commands::create_task,
      commands::get_task,
      commands::update_task,
      commands::complete_task,
      commands::uncomplete_task,
      commands::delete_task,
      commands::get_raw,
      commands::put_raw,
      commands::get_note,
      commands::put_note,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
