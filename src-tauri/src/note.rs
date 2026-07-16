//! Ported verbatim from my-ntr-server src/note.rs (workdir/server) — keep in sync if the
//! note contract changes (see tasks/01-tauri-react-client/plan.md "Accepted duplication").
//!
//! Persistent free-form note backed by a single Markdown file.
//!
//! Mirrors [`Store`](crate::store::Store)'s write-then-swap discipline: the file
//! is the canonical store, its text is cached in memory, and every save writes
//! atomically (temp + rename, via [`atomicfile`](crate::atomicfile)) and only
//! swaps the new text into memory once the write succeeds — so the file and
//! memory never diverge. The note has no structure to parse; it is a single
//! block of text.

use crate::backend::FileBackend;
use std::io;
use std::sync::Arc;

pub struct NoteStore {
  backend: Arc<dyn FileBackend>,
  name: &'static str,
  content: String,
}

impl NoteStore {
  /// Load the note from `backend`. A missing file is treated as an empty note,
  /// exactly as [`Store::load`](crate::store::Store::load) treats a missing
  /// todo.txt.
  pub fn load(backend: Arc<dyn FileBackend>, name: &'static str) -> io::Result<NoteStore> {
    let content = backend.read(name)?.unwrap_or_default();
    Ok(NoteStore {
      backend,
      name,
      content,
    })
  }

  /// The current note text.
  pub fn content(&self) -> &str {
    &self.content
  }

  /// Switch to a new backend by reloading from it. Semantics are identical
  /// to a fresh `load`: missing file = empty content.
  pub fn set_backend(&mut self, backend: Arc<dyn FileBackend>) -> io::Result<()> {
    *self = NoteStore::load(backend, self.name)?;
    Ok(())
  }

  /// Replace the whole note. Persists atomically, then swaps into memory.
  pub fn replace(&mut self, content: &str) -> io::Result<()> {
    self.backend.write(self.name, content)?;
    self.content = content.to_string();
    Ok(())
  }

  /// Pull the file back into memory: the mirror of [`replace`](NoteStore::replace),
  /// which pushes memory to disk. Re-reads the backend (a missing file is empty, as in
  /// [`load`](NoteStore::load)) and, since the note has no structure, compares the text
  /// directly. Returns `Ok(false)` and changes nothing when it matches — so the note's
  /// own just-written file is seen as "no change". When it differs (an out-of-band
  /// edit) the new text is swapped in and `Ok(true)` is returned.
  pub fn reload_from_disk(&mut self) -> io::Result<bool> {
    let content = self.backend.read(self.name)?.unwrap_or_default();
    if content == self.content {
      return Ok(false);
    }
    self.content = content;
    Ok(true)
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::backend::FsBackend;
  use crate::paths;
  use std::fs;
  use std::path::PathBuf;

  fn temp_dir(tag: &str) -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("ntr-note-{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&path);
    path
  }

  fn backend(tag: &str) -> (Arc<dyn FileBackend>, PathBuf) {
    let dir = temp_dir(tag);
    (Arc::new(FsBackend::new(dir.clone())), dir)
  }

  fn load_note(backend: Arc<dyn FileBackend>) -> NoteStore {
    NoteStore::load(backend, paths::NOTE_FILE).unwrap()
  }

  #[test]
  fn missing_file_is_empty() {
    let (backend, _) = backend("missing");
    let note = load_note(backend);
    assert_eq!(note.content(), "");
  }

  #[test]
  fn replace_persists_and_reloads() {
    let (backend, _) = backend("persist");
    {
      let mut note = load_note(backend.clone());
      note.replace("# Title\n\n- a note\n").unwrap();
      assert_eq!(note.content(), "# Title\n\n- a note\n");
    }
    let reloaded = load_note(backend);
    assert_eq!(reloaded.content(), "# Title\n\n- a note\n");
  }

  #[test]
  fn replace_overwrites() {
    let (backend, _) = backend("overwrite");
    let mut note = load_note(backend.clone());
    note.replace("first").unwrap();
    note.replace("second").unwrap();
    assert_eq!(note.content(), "second");
    assert_eq!(load_note(backend).content(), "second");
  }

  #[test]
  fn reload_from_disk_picks_up_external_edits() {
    let (backend, dir) = backend("reload");
    let path = dir.join(paths::NOTE_FILE);
    let mut note = load_note(backend);
    note.replace("mine\n").unwrap();
    // The note's own write is not a change.
    assert!(!note.reload_from_disk().unwrap());

    // Another program rewrites the file out of band.
    fs::write(&path, "# theirs\n").unwrap();
    assert!(note.reload_from_disk().unwrap());
    assert_eq!(note.content(), "# theirs\n");
    // Re-reading the same content reports no change.
    assert!(!note.reload_from_disk().unwrap());
  }

  #[test]
  fn set_path_to_absent_path_gives_empty_content() {
    let (src_backend, _) = backend("setempty-src");
    let mut note = load_note(src_backend);
    note.replace("old content\n").unwrap();

    let (dst_backend, _) = backend("setempty-dst");
    note.set_backend(dst_backend).unwrap();
    assert_eq!(note.content(), "");
  }

  #[test]
  fn set_path_loads_existing_content() {
    let (dst_backend, dir) = backend("setpath-dst");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join(paths::NOTE_FILE), "# existing note\n").unwrap();

    let (src_backend, _) = backend("setpath-src");
    let mut note = load_note(src_backend);
    note.set_backend(dst_backend).unwrap();
    assert_eq!(note.content(), "# existing note\n");
  }
}
