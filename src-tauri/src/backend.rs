use crate::atomicfile;
use crate::paths;
use std::io;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

pub trait FileBackend: Send + Sync {
  fn read(&self, name: &str) -> io::Result<Option<String>>;
  fn write(&self, name: &str, data: &str) -> io::Result<()>;
  fn remove(&self, name: &str) -> io::Result<()>;
}

#[derive(Debug)]
pub struct FsBackend {
  dir: PathBuf,
}

impl FsBackend {
  pub fn new(dir: PathBuf) -> Self {
    FsBackend { dir }
  }

  fn path(&self, name: &str) -> PathBuf {
    self.dir.join(name)
  }
}

impl FileBackend for FsBackend {
  fn read(&self, name: &str) -> io::Result<Option<String>> {
    match std::fs::read_to_string(self.path(name)) {
      Ok(c) => Ok(Some(c)),
      Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
      Err(e) => Err(e),
    }
  }

  fn write(&self, name: &str, data: &str) -> io::Result<()> {
    std::fs::create_dir_all(&self.dir)?;
    atomicfile::write(&self.path(name), data)
  }

  fn remove(&self, name: &str) -> io::Result<()> {
    match std::fs::remove_file(self.path(name)) {
      Ok(()) => Ok(()),
      Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
      Err(e) => Err(e),
    }
  }
}

#[cfg(target_os = "android")]
#[derive(Debug)]
pub struct SafBackend {
  app: AppHandle,
  tree_uri: tauri_plugin_android_fs::FsUri,
}

#[cfg(target_os = "android")]
impl SafBackend {
  pub fn new(app: AppHandle, tree_uri: tauri_plugin_android_fs::FsUri) -> Self {
    SafBackend { app, tree_uri }
  }

  fn file_uri(&self, name: &str) -> io::Result<Option<tauri_plugin_android_fs::FsUri>> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let entries = self
      .app
      .android_fs()
      .read_dir(&self.tree_uri)
      .map_err(android_io)?;
    Ok(
      entries
        .into_iter()
        .find(|entry| entry.is_file() && entry.name() == name)
        .map(|entry| entry.uri().clone()),
    )
  }

  fn existing_or_new_file_uri(&self, name: &str) -> io::Result<tauri_plugin_android_fs::FsUri> {
    use tauri_plugin_android_fs::AndroidFsExt;

    if let Some(uri) = self.file_uri(name)? {
      return Ok(uri);
    }
    self
      .app
      .android_fs()
      .create_new_file(&self.tree_uri, name, Some("text/plain"))
      .map_err(android_io)
  }
}

#[cfg(target_os = "android")]
impl FileBackend for SafBackend {
  fn read(&self, name: &str) -> io::Result<Option<String>> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let Some(uri) = self.file_uri(name)? else {
      return Ok(None);
    };
    self
      .app
      .android_fs()
      .read_to_string(&uri)
      .map(Some)
      .map_err(android_io)
  }

  fn write(&self, name: &str, data: &str) -> io::Result<()> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let uri = self.existing_or_new_file_uri(name)?;
    self.app.android_fs().write(&uri, data).map_err(android_io)
  }

  fn remove(&self, name: &str) -> io::Result<()> {
    use tauri_plugin_android_fs::AndroidFsExt;

    let Some(uri) = self.file_uri(name)? else {
      return Ok(());
    };
    self.app.android_fs().remove_file(&uri).map_err(android_io)
  }
}

#[cfg(target_os = "android")]
fn android_io(e: tauri_plugin_android_fs::Error) -> io::Error {
  io::Error::new(io::ErrorKind::Other, e.to_string())
}

pub fn is_saf_location(location: &str) -> bool {
  location.starts_with("content://")
}

pub fn backend_for(app: &AppHandle, location: Option<&str>) -> io::Result<Arc<dyn FileBackend>> {
  let location = match location {
    Some(location) if !location.trim().is_empty() => location.trim().to_string(),
    _ => paths::app_data_dir(app)?.to_string_lossy().into_owned(),
  };

  if is_saf_location(&location) {
    #[cfg(target_os = "android")]
    {
      let tree_uri = saf_tree_uri(location);
      return Ok(Arc::new(SafBackend::new(app.clone(), tree_uri)));
    }
    #[cfg(not(target_os = "android"))]
    {
      return Err(io::Error::new(
        io::ErrorKind::InvalidInput,
        "content URI data directories are only supported on Android",
      ));
    }
  }

  let dir = PathBuf::from(location);
  std::fs::create_dir_all(&dir)?;
  Ok(Arc::new(FsBackend::new(dir)))
}

#[cfg(target_os = "android")]
pub fn saf_display_name(app: &AppHandle, location: &str) -> io::Result<String> {
  use tauri_plugin_android_fs::AndroidFsExt;

  let uri = saf_tree_uri(location.to_string());
  Ok(app.android_fs().get_name_or_last_path_segment(&uri))
}

#[cfg(not(target_os = "android"))]
pub fn saf_display_name(_app: &AppHandle, location: &str) -> io::Result<String> {
  Ok(location.to_string())
}

#[cfg(target_os = "android")]
pub async fn pick_saf_dir(app: &AppHandle) -> io::Result<Option<String>> {
  use tauri_plugin_android_fs::AndroidFsExt;

  let picked = app
    .android_fs_async()
    .picker()
    .pick_dir(None, false)
    .await
    .map_err(android_io)?;
  if let Some(uri) = &picked {
    app
      .android_fs_async()
      .picker()
      .persist_uri_permission(uri)
      .await
      .map_err(android_io)?;
  }
  Ok(picked.map(|uri| uri.uri))
}

#[cfg(target_os = "android")]
fn saf_tree_uri(uri: impl Into<String>) -> tauri_plugin_android_fs::FsUri {
  let uri = uri.into();
  tauri_plugin_android_fs::FsUri {
    uri: uri.clone(),
    document_top_tree_uri: Some(uri),
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("ntr-backend-{}-{}", tag, std::process::id()));
    let _ = std::fs::remove_dir_all(&p);
    p
  }

  #[test]
  fn fs_read_missing_is_none() {
    let backend = FsBackend::new(temp_dir("missing"));
    assert!(backend.read(paths::TODO_FILE).unwrap().is_none());
  }

  #[test]
  fn fs_write_then_read_roundtrip() {
    let backend = FsBackend::new(temp_dir("rw"));
    backend.write(paths::TODO_FILE, "hello\n").unwrap();
    assert_eq!(
      backend.read(paths::TODO_FILE).unwrap().as_deref(),
      Some("hello\n")
    );
  }

  #[test]
  fn fs_remove_missing_is_ok() {
    let backend = FsBackend::new(temp_dir("rm-missing"));
    backend.remove(paths::TODO_FILE).unwrap();
  }
}
