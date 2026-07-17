//! my-ntr Tauri client: a local-first todo.txt + Markdown-note app that reproduces the
//! my-ntr-server WebUI, backed by local files instead of an HTTP server.

mod atomicfile;
mod backend;
mod commands;
mod dto;
mod http;
mod labelstore;
mod note;
mod paths;
mod state;
mod store;
mod task;
mod watch;

use labelstore::LabelStore;
use note::NoteStore;
use state::AppState;
use store::Store;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  let builder = tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_dialog::init());
  #[cfg(target_os = "android")]
  let builder = builder.plugin(tauri_plugin_android_fs::init());

  builder
    .setup(|app| {
      // Resolve the local data backend, load both stores, and make them shared state.
      let location = paths::resolve_data_dir(app.handle())?;
      let backend = backend::backend_for(app.handle(), Some(&location))?;
      let store = Store::load(backend.clone(), paths::TODO_FILE)?;
      let note = NoteStore::load(backend.clone(), paths::NOTE_FILE)?;
      let labels = LabelStore::load(backend, paths::LABELS_FILE)?;
      app.manage(AppState::new(store, note, labels));

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
      commands::get_labels,
      commands::put_labels,
      commands::get_data_dir,
      commands::pick_data_dir,
      commands::storage_kind,
      commands::set_data_dir,
      http::server_fetch,
      http::server_connect,
      http::server_disconnect,
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
