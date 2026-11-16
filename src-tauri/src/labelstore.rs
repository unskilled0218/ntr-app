use crate::backend::FileBackend;
use serde::{Deserialize, Serialize};
use std::io;
use std::sync::Arc;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
pub struct Labels {
  // Retain existing labels.json and IPC serialization while renaming domain code.
  #[serde(rename = "project")]
  pub list: Vec<String>,
  pub context: Vec<String>,
}

pub struct LabelStore {
  backend: Arc<dyn FileBackend>,
  name: &'static str,
  labels: Labels,
}

impl LabelStore {
  pub fn load(backend: Arc<dyn FileBackend>, name: &'static str) -> io::Result<Self> {
    let labels = backend
      .read(name)?
      .and_then(|text| serde_json::from_str(&text).ok())
      .unwrap_or_default();
    Ok(Self {
      backend,
      name,
      labels,
    })
  }

  pub fn get(&self) -> Labels {
    self.labels.clone()
  }

  pub fn replace(&mut self, labels: Labels) -> io::Result<()> {
    let text = serde_json::to_string(&labels)
      .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e.to_string()))?;
    self.backend.write(self.name, &text)?;
    self.labels = labels;
    Ok(())
  }

  pub fn set_backend(&mut self, backend: Arc<dyn FileBackend>) -> io::Result<()> {
    *self = Self::load(backend, self.name)?;
    Ok(())
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::backend::FsBackend;
  use crate::paths;
  use std::fs;
  use std::path::PathBuf;

  fn backend(tag: &str) -> (Arc<dyn FileBackend>, PathBuf) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("ntr-labels-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    (Arc::new(FsBackend::new(dir.clone())), dir)
  }

  #[test]
  fn missing_file_is_empty() {
    let (backend, _) = backend("missing");
    assert_eq!(
      LabelStore::load(backend, paths::LABELS_FILE).unwrap().get(),
      Labels::default()
    );
  }

  #[test]
  fn existing_labels_file_keeps_legacy_key_and_names_after_write() {
    let (backend, _) = backend("legacy-key");
    backend
      .write(
        paths::LABELS_FILE,
        r#"{"project":["work","my-project"],"context":["phone"]}"#,
      )
      .unwrap();
    let mut store = LabelStore::load(backend.clone(), paths::LABELS_FILE).unwrap();
    assert_eq!(store.get().list, vec!["work", "my-project"]);
    store.replace(store.get()).unwrap();
    let saved: serde_json::Value =
      serde_json::from_str(&backend.read(paths::LABELS_FILE).unwrap().unwrap()).unwrap();
    assert_eq!(saved["project"], serde_json::json!(["work", "my-project"]));
    assert!(saved.get("list").is_none());
    assert_eq!(
      LabelStore::load(backend, paths::LABELS_FILE).unwrap().get(),
      store.get()
    );
  }

  #[test]
  fn replace_then_get_round_trips() {
    let (backend, _) = backend("roundtrip");
    let expected = Labels {
      list: vec!["work".into()],
      context: vec!["phone".into()],
    };
    let mut store = LabelStore::load(backend.clone(), paths::LABELS_FILE).unwrap();
    store.replace(expected.clone()).unwrap();
    assert_eq!(store.get(), expected);
    assert_eq!(
      LabelStore::load(backend, paths::LABELS_FILE).unwrap().get(),
      expected
    );
  }

  #[test]
  fn malformed_json_is_empty() {
    let (backend, _) = backend("malformed");
    backend.write(paths::LABELS_FILE, "not json").unwrap();
    assert_eq!(
      LabelStore::load(backend, paths::LABELS_FILE).unwrap().get(),
      Labels::default()
    );
  }
}
