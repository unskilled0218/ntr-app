//! The one home for "where the local files live" and the two surviving config knobs.
//!
//! The server read these from environment variables (src/config.rs); a desktop/mobile app has
//! no env to configure, so the files live in a user-configurable data directory (defaulting to
//! Tauri's per-app data directory). The chosen path is persisted in `config.json` inside the
//! fixed app-data directory, which is always separate from the data directory itself so the
//! config survives path changes.

use crate::atomicfile;
use serde::{Deserialize, Serialize};
use std::io;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// todo.txt file name within the data directory.
pub const TODO_FILE: &str = "todo.txt";
/// Markdown note file name within the data directory.
pub const NOTE_FILE: &str = "Note.md";
/// Remembered project and context labels within the data directory.
pub const LABELS_FILE: &str = "labels.json";
/// Config file name within the fixed app-data directory.
const CONFIG_FILE: &str = "config.json";

/// Stamp a creation date on new incomplete tasks that lack one (server default
/// `TODO_ADD_CREATION_DATE = true`). The one home for "do we stamp creation dates?".
pub const ADD_CREATION_DATE: bool = true;

#[derive(Serialize, Deserialize, Default)]
struct Config {
  #[serde(skip_serializing_if = "Option::is_none")]
  data_dir: Option<String>,
}

// --- Private helpers (no Tauri dependency; testable with a temp path) ---

fn read_custom_data_dir(config_path: &std::path::Path) -> io::Result<Option<String>> {
  let text = match std::fs::read_to_string(config_path) {
    Ok(t) => t,
    Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
    Err(e) => return Err(e),
  };
  let cfg: Config = serde_json::from_str(&text)
    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
  Ok(cfg.data_dir)
}

fn write_custom_data_dir(config_path: &std::path::Path, dir: Option<&str>) -> io::Result<()> {
  let cfg = Config {
    data_dir: dir.map(str::to_string),
  };
  let text = serde_json::to_string(&cfg)
    .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
  atomicfile::write(config_path, &text)
}

// --- Public API ---

/// The fixed Tauri app-data directory. The config file always lives here,
/// regardless of where the user has pointed the data directory.
pub fn app_data_dir(app: &AppHandle) -> io::Result<PathBuf> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| io::Error::new(io::ErrorKind::NotFound, e.to_string()))?;
  std::fs::create_dir_all(&dir)?;
  Ok(dir)
}

/// Read the stored custom data directory (`None` = not set / use default).
pub fn load_custom_data_dir(app: &AppHandle) -> io::Result<Option<String>> {
  let config_path = app_data_dir(app)?.join(CONFIG_FILE);
  read_custom_data_dir(&config_path)
}

/// Persist a custom data directory. Pass `None` to clear (revert to default).
pub fn save_custom_data_dir(app: &AppHandle, dir: Option<&str>) -> io::Result<()> {
  let config_path = app_data_dir(app)?.join(CONFIG_FILE);
  write_custom_data_dir(&config_path, dir)
}

/// Resolve the location used for `todo.txt` and `Note.md`. Returns the custom
/// filesystem path or SAF `content://` URI from config if set, otherwise the
/// app-data directory path.
pub fn resolve_data_dir(app: &AppHandle) -> io::Result<String> {
  if let Some(custom) = load_custom_data_dir(app)? {
    return Ok(custom);
  }
  app_data_dir(app).map(|p| p.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;

  fn temp_config(tag: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("ntr-config-{}-{}.json", tag, std::process::id()));
    let _ = fs::remove_file(&p);
    p
  }

  #[test]
  fn no_config_file_returns_none() {
    let p = temp_config("absent");
    assert!(read_custom_data_dir(&p).unwrap().is_none());
  }

  #[test]
  fn write_then_read_roundtrip() {
    let p = temp_config("rw");
    let dir = "/tmp/my-notes";
    write_custom_data_dir(&p, Some(dir)).unwrap();
    assert_eq!(read_custom_data_dir(&p).unwrap().as_deref(), Some(dir));
  }

  #[test]
  fn write_none_clears_setting() {
    let p = temp_config("clear");
    write_custom_data_dir(&p, Some("/tmp/notes")).unwrap();
    write_custom_data_dir(&p, None).unwrap();
    assert!(read_custom_data_dir(&p).unwrap().is_none());
  }

  #[test]
  fn config_file_is_valid_json() {
    let p = temp_config("json");
    write_custom_data_dir(&p, Some("/tmp/notes")).unwrap();
    let text = fs::read_to_string(&p).unwrap();
    assert!(serde_json::from_str::<serde_json::Value>(&text).is_ok());
  }
}
