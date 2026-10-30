//! Headless integration bridge for the real local store and DTO, without a webview.
#![allow(dead_code)]

#[path = "../src/atomicfile.rs"]
mod atomicfile;
#[path = "../src/backend.rs"]
mod backend;
#[path = "../src/dto.rs"]
mod dto;
#[path = "../src/paths.rs"]
mod paths;
#[path = "../src/store.rs"]
mod store;
#[path = "../src/task.rs"]
mod task;

fn main() {
  let args: Vec<String> = std::env::args().collect();
  let backend = std::sync::Arc::new(backend::FsBackend::new(args[1].clone().into()));
  let mut store = store::Store::load(backend, paths::TODO_FILE).unwrap();
  let today = chrono::NaiveDate::from_ymd_opt(2026, 10, 30).unwrap();
  let id = store
    .list(&store::Filter::default())
    .first()
    .map(|entry| entry.id)
    .unwrap_or(1);
  match args[2].as_str() {
    "raw" => store.replace_raw(&args[3]).unwrap(),
    "add" => {
      store.add(&args[3], false, today).unwrap();
    }
    "edit" => store.update(id, &args[3]).unwrap(),
    "complete" => store.complete(id, today).unwrap(),
    "reopen" => store.uncomplete(id).unwrap(),
    "get" => {}
    _ => panic!("unknown operation"),
  }
  println!(
    "{}",
    serde_json::to_string(&dto::TaskDto::from_entry(
      store.list(&store::Filter::default())[0]
    ))
    .unwrap()
  );
}
