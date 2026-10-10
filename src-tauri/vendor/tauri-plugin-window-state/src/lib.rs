// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT
// Locally modified: coordinate native modes and preserve normal bounds; see ../PATCH.md.

//! Save window positions and sizes and restore them when the app is reopened.

#![doc(
  html_logo_url = "https://github.com/tauri-apps/tauri/raw/dev/app-icon.png",
  html_favicon_url = "https://github.com/tauri-apps/tauri/raw/dev/app-icon.png"
)]
#![cfg(not(any(target_os = "android", target_os = "ios")))]

use bitflags::bitflags;
use serde::{Deserialize, Serialize};
use tauri::{
  plugin::{Builder as PluginBuilder, TauriPlugin},
  AppHandle, Manager, Monitor, PhysicalPosition, PhysicalSize, RunEvent, Runtime, WebviewWindow,
  Window, WindowEvent,
};

use std::{
  collections::{HashMap, HashSet},
  fs::create_dir_all,
  io::BufReader,
  sync::atomic::{AtomicU64, Ordering},
  sync::{Arc, Mutex},
  time::Instant,
};

mod cmd;
mod restore;
use restore::{Action, Attempt, Observation, NORMAL_SETTLE, RESTORE_POLL};

static NEXT_RESTORE_ID: AtomicU64 = AtomicU64::new(1);

type LabelMapperFn = dyn Fn(&str) -> &str + Send + Sync;
type FilterCallbackFn = dyn Fn(&str) -> bool + Send + Sync;

/// Default filename used to store window state.
///
/// If using a custom filename, you should probably use [`AppHandleExt::filename`] instead.
pub const DEFAULT_FILENAME: &str = ".window-state.json";

#[derive(Debug, thiserror::Error)]
pub enum Error {
  #[error(transparent)]
  Io(#[from] std::io::Error),
  #[error(transparent)]
  Tauri(#[from] tauri::Error),
  #[error(transparent)]
  SerdeJson(#[from] serde_json::Error),
}

pub type Result<T> = std::result::Result<T, Error>;

bitflags! {
    #[derive(Clone, Copy, Debug)]
    pub struct StateFlags: u32 {
        const SIZE        = 1 << 0;
        const POSITION    = 1 << 1;
        const MAXIMIZED   = 1 << 2;
        const VISIBLE     = 1 << 3;
        const DECORATIONS = 1 << 4;
        const FULLSCREEN  = 1 << 5;
    }
}

impl Default for StateFlags {
  /// Default to [`all`](Self::all)
  fn default() -> Self {
    Self::all()
  }
}

struct PluginState {
  pub(crate) state_flags: StateFlags,
  filename: String,
  map_label: Option<Box<LabelMapperFn>>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
struct WindowState {
  width: u32,
  height: u32,
  x: i32,
  y: i32,
  // prev_x and prev_y are used to store position
  // before maximization happened, because maximization
  // will set x and y to the top-left corner of the monitor
  prev_x: i32,
  prev_y: i32,
  maximized: bool,
  visible: bool,
  decorated: bool,
  fullscreen: bool,
  #[serde(skip)]
  pending_restore: Option<Attempt>,
  #[serde(skip)]
  protect_geometry: bool,
  #[serde(skip)]
  normal_candidate: Option<(Bounds, Instant)>,
}

impl Default for WindowState {
  fn default() -> Self {
    Self {
      width: Default::default(),
      height: Default::default(),
      x: Default::default(),
      y: Default::default(),
      prev_x: Default::default(),
      prev_y: Default::default(),
      maximized: Default::default(),
      visible: true,
      decorated: true,
      fullscreen: Default::default(),
      pending_restore: None,
      protect_geometry: false,
      normal_candidate: None,
    }
  }
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct Bounds {
  size: (u32, u32),
  position: (i32, i32),
}

impl WindowState {
  fn restore_position(&self) -> (i32, i32) {
    if self.maximized {
      (self.prev_x, self.prev_y)
    } else {
      (self.x, self.y)
    }
  }
  fn remember_position(&mut self, position: (i32, i32)) {
    self.x = position.0;
    self.y = position.1;
    self.prev_x = self.x;
    self.prev_y = self.y;
  }

  fn next_restore(&mut self, id: u64, observed: Observation, now: Instant) -> Option<Action> {
    let attempt = self
      .pending_restore
      .as_mut()
      .filter(|attempt| attempt.id == id)?;
    let action = attempt.next(observed, now);
    if action == Action::Complete || action == Action::Fail {
      self.finish_restore(id, action == Action::Complete);
    }
    Some(action)
  }

  fn finish_restore(&mut self, id: u64, success: bool) {
    if let Some(attempt) = self
      .pending_restore
      .as_ref()
      .filter(|attempt| attempt.id == id)
    {
      self.protect_geometry = !success || attempt.clamped;
      self.normal_candidate = None;
      self.pending_restore = None;
    }
  }

  fn cancel_restore(&mut self) {
    if let Some(attempt) = &self.pending_restore {
      self.finish_restore(attempt.id, false);
    }
  }

  fn observe_modes(&mut self, observed: Observation, flags: StateFlags) {
    if self.pending_restore.is_some() {
      return;
    }
    if let (Some(fullscreen), Some(maximized), Some(false)) =
      (observed.fullscreen, observed.maximized, observed.minimized)
    {
      if flags.contains(StateFlags::FULLSCREEN) {
        self.fullscreen = fullscreen;
      }
      // Fullscreen may hide the underlying maximized mode on some platforms.
      if flags.contains(StateFlags::MAXIMIZED) && !fullscreen {
        self.maximized = maximized;
      }
    }
  }

  fn capture_bounds(
    &mut self,
    observed: Observation,
    bounds: Bounds,
    flags: StateFlags,
    now: Instant,
  ) {
    if self.pending_restore.is_some() || !observed.normal() {
      self.normal_candidate = None;
      return;
    }
    if self.protect_geometry {
      match self.normal_candidate {
        Some((previous, since))
          if previous == bounds && now.duration_since(since) >= NORMAL_SETTLE =>
        {
          self.protect_geometry = false;
          self.normal_candidate = None;
        }
        Some((previous, _)) if previous == bounds => return,
        _ => {
          self.normal_candidate = Some((bounds, now));
          return;
        }
      }
    }
    if flags.contains(StateFlags::SIZE) && bounds.size.0 > 0 && bounds.size.1 > 0 {
      self.width = bounds.size.0;
      self.height = bounds.size.1;
    }
    if flags.contains(StateFlags::POSITION) {
      self.remember_position(bounds.position);
    }
  }
}

fn observation<R: Runtime>(window: &Window<R>) -> Observation {
  Observation {
    size: window
      .inner_size()
      .ok()
      .map(|size| (size.width, size.height)),
    maximized: if cfg!(target_os = "macos") {
      // Preserve upstream's special case, but never treat a failed query as false.
      match (window.is_decorated().ok(), window.is_resizable().ok()) {
        (Some(decorated), Some(resizable)) if !decorated || !resizable => Some(false),
        (Some(_), Some(_)) => window.is_maximized().ok(),
        _ => None,
      }
    } else {
      window.is_maximized().ok()
    },
    fullscreen: window.is_fullscreen().ok(),
    minimized: window.is_minimized().ok(),
  }
}

// Queries and setters run without the cache mutex held. Every callback rechecks its attempt id.
fn advance_restore<R: Runtime>(window: &Window<R>, id: u64) {
  let cache = window.state::<WindowStateCache>().0.clone();
  let plugin = window.state::<PluginState>();
  let label = plugin
    .map_label
    .as_ref()
    .map(|map| map(window.label()))
    .unwrap_or_else(|| window.label());
  for _ in 0..4 {
    let observed = observation(window);
    let action = cache
      .lock()
      .unwrap()
      .get_mut(label)
      .and_then(|state| state.next_restore(id, observed, Instant::now()));
    let result = match action {
      Some(Action::Maximize(true)) => window.maximize(),
      Some(Action::Maximize(false)) => window.unmaximize(),
      Some(Action::Fullscreen(value)) => window.set_fullscreen(value),
      Some(Action::Fail) => {
        log::warn!("Window mode restoration failed or timed out: {label}");
        return;
      }
      _ => return,
    };
    if let Err(error) = result {
      if let Some(state) = cache.lock().unwrap().get_mut(label) {
        state.finish_restore(id, false);
      }
      log::warn!("Window mode restoration request failed for {label}: {error}");
      return;
    }
  }
}

fn start_restore_poll<R: Runtime>(window: Window<R>, label: String, id: u64) {
  let cache = window.state::<WindowStateCache>().0.clone();
  std::thread::spawn(move || loop {
    std::thread::sleep(RESTORE_POLL);
    let active = cache
      .lock()
      .unwrap()
      .get(&label)
      .and_then(|state| state.pending_restore.as_ref())
      .is_some_and(|attempt| attempt.id == id);
    if !active {
      break;
    }
    let callback_window = window.clone();
    if window
      .run_on_main_thread(move || advance_restore(&callback_window, id))
      .is_err()
    {
      if let Some(state) = cache.lock().unwrap().get_mut(&label) {
        state.finish_restore(id, false);
      }
      break;
    }
  });
}

struct WindowStateCache(Arc<Mutex<HashMap<String, WindowState>>>);
/// Used to prevent deadlocks from resize and position event listeners setting the cached state on restoring states
struct RestoringWindowState(Mutex<()>);

pub trait AppHandleExt {
  /// Saves all open windows state to disk
  fn save_window_state(&self, flags: StateFlags) -> Result<()>;
  /// Get the name of the file used to store window state.
  fn filename(&self) -> String;
}

impl<R: Runtime> AppHandleExt for tauri::AppHandle<R> {
  fn save_window_state(&self, flags: StateFlags) -> Result<()> {
    let app_dir = self.path().app_config_dir()?;
    let plugin_state = self.state::<PluginState>();
    let state_path = app_dir.join(&plugin_state.filename);
    let windows = self.webview_windows();
    let cache = self.state::<WindowStateCache>();
    let mut state = cache.0.lock().unwrap();

    for (label, s) in state.iter_mut() {
      let window = if let Some(map) = &plugin_state.map_label {
        windows
          .iter()
          .find_map(|(l, window)| (map(l) == label).then_some(window))
      } else {
        windows.get(label)
      };

      if let Some(window) = window {
        window.update_state(s, flags)?;
      }
    }

    create_dir_all(app_dir)?;
    std::fs::write(state_path, serde_json::to_vec_pretty(&*state)?)?;

    Ok(())
  }

  fn filename(&self) -> String {
    self.state::<PluginState>().filename.clone()
  }
}

pub trait WindowExt {
  /// Restores this window state from disk
  fn restore_state(&self, flags: StateFlags) -> tauri::Result<()>;
}

impl<R: Runtime> WindowExt for WebviewWindow<R> {
  fn restore_state(&self, flags: StateFlags) -> tauri::Result<()> {
    self.as_ref().window().restore_state(flags)
  }
}

impl<R: Runtime> WindowExt for Window<R> {
  fn restore_state(&self, flags: StateFlags) -> tauri::Result<()> {
    let plugin_state = self.app_handle().state::<PluginState>();
    let label = plugin_state
      .map_label
      .as_ref()
      .map(|map| map(self.label()))
      .unwrap_or_else(|| self.label())
      .to_string();

    let restoring_window_state = self.state::<RestoringWindowState>();
    let _restoring_window_lock = restoring_window_state.0.lock().unwrap();
    let cache = self.state::<WindowStateCache>().0.clone();
    let saved = cache
      .lock()
      .unwrap()
      .get(&label)
      .cloned()
      .filter(|state| *state != WindowState::default());

    let mut should_show = true;

    if let Some(mut state) = saved {
      // Existing maximized entries store their normal position in prev_x/prev_y.
      let position = state.restore_position();
      state.remember_position(position);
      let size = if flags.contains(StateFlags::SIZE) {
        (state.width, state.height)
      } else {
        let size = self.inner_size()?;
        (size.width, size.height)
      };
      let id = NEXT_RESTORE_ID.fetch_add(1, Ordering::Relaxed);
      let maximized = flags.contains(StateFlags::MAXIMIZED) && state.maximized;
      let fullscreen = flags.contains(StateFlags::FULLSCREEN) && state.fullscreen;
      state.pending_restore = Some(Attempt::new(
        id,
        size,
        maximized,
        fullscreen,
        Instant::now(),
      ));
      state.protect_geometry = false;
      state.normal_candidate = None;
      should_show = state.visible;
      cache.lock().unwrap().insert(label.clone(), state.clone());
      let geometry_result = (|| -> tauri::Result<()> {
        if flags.contains(StateFlags::DECORATIONS) {
          self.set_decorations(state.decorated)?;
        }

        if flags.contains(StateFlags::POSITION) {
          let position = (state.x, state.y).into();
          let size = (state.width, state.height).into();
          // restore position to saved value if saved monitor exists
          // otherwise, let the OS decide where to place the window
          for m in self.available_monitors()? {
            if m.intersects(position, size) {
              self.set_position(PhysicalPosition {
                x: state.x,
                y: state.y,
              })?;
            }
          }
        }

        if flags.contains(StateFlags::SIZE) {
          self.set_size(PhysicalSize {
            width: state.width,
            height: state.height,
          })?;
        }
        Ok(())
      })();
      if let Err(error) = geometry_result {
        if let Some(state) = cache.lock().unwrap().get_mut(&label) {
          state.finish_restore(id, false);
        }
        return Err(error);
      }

      advance_restore(self, id);
      start_restore_poll(self.clone(), label.clone(), id);
    } else {
      let mut metadata = WindowState::default();

      if flags.contains(StateFlags::SIZE) {
        let size = self.inner_size()?;
        metadata.width = size.width;
        metadata.height = size.height;
      }

      if flags.contains(StateFlags::POSITION) {
        let pos = self.outer_position()?;
        metadata.remember_position((pos.x, pos.y));
      }

      if flags.contains(StateFlags::MAXIMIZED) {
        metadata.maximized = self.is_maximized()?;
      }

      if flags.contains(StateFlags::VISIBLE) {
        metadata.visible = self.is_visible()?;
      }

      if flags.contains(StateFlags::DECORATIONS) {
        metadata.decorated = self.is_decorated()?;
      }

      if flags.contains(StateFlags::FULLSCREEN) {
        metadata.fullscreen = self.is_fullscreen()?;
      }

      cache.lock().unwrap().insert(label, metadata);
    }

    if flags.contains(StateFlags::VISIBLE) && should_show {
      self.show()?;
      self.set_focus()?;
    }

    Ok(())
  }
}

trait WindowExtInternal {
  fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()>;
}

impl<R: Runtime> WindowExtInternal for WebviewWindow<R> {
  fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()> {
    self.as_ref().window().update_state(state, flags)
  }
}

impl<R: Runtime> WindowExtInternal for Window<R> {
  fn update_state(&self, state: &mut WindowState, flags: StateFlags) -> tauri::Result<()> {
    let observed = observation(self);
    state.observe_modes(observed, flags);

    if flags.contains(StateFlags::DECORATIONS) {
      state.decorated = self.is_decorated()?;
    }

    if flags.contains(StateFlags::VISIBLE) {
      state.visible = self.is_visible()?;
    }

    if let (Some(size), Ok(position)) = (observed.size, self.outer_position()) {
      state.capture_bounds(
        observed,
        Bounds {
          size,
          position: (position.x, position.y),
        },
        flags,
        Instant::now(),
      );
    }

    Ok(())
  }
}

#[derive(Default)]
pub struct Builder {
  denylist: HashSet<String>,
  filter_callback: Option<Box<FilterCallbackFn>>,
  skip_initial_state: HashSet<String>,
  state_flags: StateFlags,
  map_label: Option<Box<LabelMapperFn>>,
  filename: Option<String>,
}

impl Builder {
  pub fn new() -> Self {
    Self::default()
  }

  /// Sets the state flags to control what state gets restored and saved.
  pub fn with_state_flags(mut self, flags: StateFlags) -> Self {
    self.state_flags = flags;
    self
  }

  /// Sets a custom filename to use when saving and restoring window states from disk.
  pub fn with_filename(mut self, filename: impl Into<String>) -> Self {
    self.filename.replace(filename.into());
    self
  }

  /// Sets a list of windows that shouldn't be tracked and managed by this plugin
  /// For example, splash screen windows.
  pub fn with_denylist(mut self, denylist: &[&str]) -> Self {
    self.denylist = denylist.iter().map(|l| l.to_string()).collect();
    self
  }

  /// Sets a filter callback to exclude specific windows from being tracked.
  /// Return `true` to save the state, or `false` to skip and not save it.
  pub fn with_filter<F>(mut self, filter_callback: F) -> Self
  where
    F: Fn(&str) -> bool + Send + Sync + 'static,
  {
    self.filter_callback = Some(Box::new(filter_callback));
    self
  }

  /// Adds the given window label to a list of windows to skip initial state restore.
  pub fn skip_initial_state(mut self, label: &str) -> Self {
    self.skip_initial_state.insert(label.into());
    self
  }

  /// Transforms the window label when saving the window state.
  ///
  /// This can be used to group different windows to use the same state.
  pub fn map_label<F>(mut self, map_fn: F) -> Self
  where
    F: Fn(&str) -> &str + Sync + Send + 'static,
  {
    self.map_label = Some(Box::new(map_fn));
    self
  }

  pub fn build<R: Runtime>(self) -> TauriPlugin<R> {
    let state_flags = self.state_flags;
    let filename = self.filename.unwrap_or_else(|| DEFAULT_FILENAME.into());
    let map_label = self.map_label;

    PluginBuilder::new("window-state")
      .invoke_handler(tauri::generate_handler![
        cmd::save_window_state,
        cmd::restore_state,
        cmd::filename
      ])
      .setup(move |app, _api| {
        let cache = load_saved_window_states(app, &filename).unwrap_or_default();
        app.manage(WindowStateCache(Arc::new(Mutex::new(cache))));
        app.manage(RestoringWindowState(Mutex::new(())));
        app.manage(PluginState {
          state_flags,
          filename,
          map_label,
        });
        Ok(())
      })
      .on_window_ready(move |window| {
        let plugin_state = window.app_handle().state::<PluginState>();
        let label = plugin_state
          .map_label
          .as_ref()
          .map(|map| map(window.label()))
          .unwrap_or_else(|| window.label());

        // Check deny list names
        if self.denylist.contains(label) {
          return;
        }

        // Check deny list callback
        if let Some(filter_callback) = &self.filter_callback {
          // Don't save the state if the callback returns false
          if !filter_callback(label) {
            return;
          }
        }

        if !self.skip_initial_state.contains(label) {
          let _ = window.restore_state(state_flags);
        }

        let cache = window.state::<WindowStateCache>();
        let cache = cache.0.clone();
        let label = label.to_string();
        let window_clone = window.clone();

        // insert a default state if this window should be tracked and
        // the disk cache doesn't have a state for it
        {
          cache
            .lock()
            .unwrap()
            .entry(label.clone())
            .or_insert_with(WindowState::default);
        }

        window.on_window_event(move |e| match e {
          WindowEvent::CloseRequested { .. } => {
            let mut c = cache.lock().unwrap();
            if let Some(state) = c.get_mut(&label) {
              state.cancel_restore();
              let _ = window_clone.update_state(state, state_flags);
            }
          }

          WindowEvent::Moved(_) | WindowEvent::Resized(_) => {
            let id = cache
              .lock()
              .unwrap()
              .get(&label)
              .and_then(|state| state.pending_restore.as_ref())
              .map(|attempt| attempt.id);
            if let Some(id) = id {
              advance_restore(&window_clone, id);
            }
            if window_clone
              .state::<RestoringWindowState>()
              .0
              .try_lock()
              .is_ok()
            {
              let observed = observation(&window_clone);
              let position = window_clone.outer_position().ok();
              let mut c = cache.lock().unwrap();
              if let Some(state) = c.get_mut(&label) {
                state.observe_modes(observed, state_flags);
                if let (Some(size), Some(position)) = (observed.size, position) {
                  state.capture_bounds(
                    observed,
                    Bounds {
                      size,
                      position: (position.x, position.y),
                    },
                    state_flags,
                    Instant::now(),
                  );
                }
              }
            }
          }
          _ => {}
        });
      })
      .on_event(move |app, event| {
        if let RunEvent::Exit = event {
          let _ = app.save_window_state(state_flags);
        }
      })
      .build()
  }
}

fn load_saved_window_states<R: Runtime>(
  app: &AppHandle<R>,
  filename: &String,
) -> Result<HashMap<String, WindowState>> {
  let app_dir = app.path().app_config_dir()?;
  let state_path = app_dir.join(filename);
  let file = std::fs::File::open(state_path)?;
  let reader = BufReader::new(file);
  let states = serde_json::from_reader(reader)?;
  Ok(states)
}

trait MonitorExt {
  fn intersects(&self, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool;
}

impl MonitorExt for Monitor {
  fn intersects(&self, position: PhysicalPosition<i32>, size: PhysicalSize<u32>) -> bool {
    let PhysicalPosition { x, y } = *self.position();
    let PhysicalSize { width, height } = *self.size();

    let left = x;
    let right = x + width as i32;
    let top = y;
    let bottom = y + height as i32;

    [
      (position.x, position.y),
      (position.x + size.width as i32, position.y),
      (position.x, position.y + size.height as i32),
      (
        position.x + size.width as i32,
        position.y + size.height as i32,
      ),
    ]
    .into_iter()
    .any(|(x, y)| x >= left && x < right && y >= top && y < bottom)
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn normal() -> Observation {
    Observation {
      size: Some((720, 480)),
      maximized: Some(false),
      fullscreen: Some(false),
      minimized: Some(false),
    }
  }

  fn saved() -> WindowState {
    WindowState {
      width: 720,
      height: 480,
      x: 220,
      y: 180,
      prev_x: 220,
      prev_y: 180,
      ..WindowState::default()
    }
  }

  fn flags() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED | StateFlags::FULLSCREEN
  }

  #[test]
  fn mode_samples_keep_normal_bounds_and_preserve_underlying_maximization() {
    let mut state = saved();
    let now = Instant::now();
    let monitor = Bounds {
      size: (3840, 2160),
      position: (0, 0),
    };
    let maximized = Observation {
      maximized: Some(true),
      size: Some(monitor.size),
      ..normal()
    };
    state.observe_modes(maximized, flags());
    state.capture_bounds(maximized, monitor, flags(), now);
    assert!(state.maximized);
    let fullscreen = Observation {
      fullscreen: Some(true),
      maximized: Some(false),
      ..maximized
    };
    state.observe_modes(fullscreen, flags());
    state.capture_bounds(fullscreen, monitor, flags(), now);
    assert!(state.maximized && state.fullscreen);
    assert_eq!(
      (state.width, state.height, state.restore_position()),
      (720, 480, (220, 180))
    );
    state.observe_modes(normal(), flags());
    state.capture_bounds(
      normal(),
      Bounds {
        size: (720, 480),
        position: (300, 240),
      },
      flags(),
      now,
    );
    assert!(!state.maximized && !state.fullscreen);
    assert_eq!(
      (state.x, state.y, state.prev_x, state.prev_y),
      (300, 240, 300, 240)
    );
  }

  #[test]
  fn unknown_mode_queries_preserve_cached_modes_and_geometry() {
    for unknown in 0..3 {
      let mut state = saved();
      state.maximized = true;
      state.fullscreen = true;
      let original = state.clone();
      let mut observed = normal();
      match unknown {
        0 => observed.fullscreen = None,
        1 => observed.maximized = None,
        _ => observed.minimized = None,
      }
      state.observe_modes(observed, flags());
      state.capture_bounds(
        observed,
        Bounds {
          size: (3840, 2160),
          position: (0, 0),
        },
        flags(),
        Instant::now(),
      );
      assert_eq!(state, original, "unknown query index {unknown}");
    }
  }

  #[test]
  fn closes_failures_and_superseded_attempts_make_old_callbacks_inert() {
    let now = Instant::now();
    let mut state = saved();
    state.pending_restore = Some(Attempt::new(1, (720, 480), true, true, now));
    assert_eq!(
      state.next_restore(1, normal(), now),
      Some(Action::Maximize(true))
    );
    // The native setter failed; no late observation may continue its attempt.
    state.finish_restore(1, false);
    assert_eq!(state.next_restore(1, normal(), now), None);
    assert!(state.protect_geometry);
    state.pending_restore = Some(Attempt::new(2, (720, 480), false, true, now));
    assert_eq!(state.next_restore(1, normal(), now), None);
    assert_eq!(
      state.next_restore(2, normal(), now),
      Some(Action::Fullscreen(true))
    );
    state.cancel_restore();
    assert_eq!(state.next_restore(2, normal(), now), None);
    assert_eq!(
      (state.width, state.height, state.restore_position()),
      (720, 480, (220, 180))
    );
  }

  #[test]
  fn deadline_failure_keeps_bounds_until_confirmed_normal_samples_settle() {
    let now = Instant::now();
    let mut state = saved();
    state.pending_restore = Some(Attempt::new(1, (720, 480), true, true, now));
    assert_eq!(
      state.next_restore(1, normal(), now),
      Some(Action::Maximize(true))
    );
    let expired = now + restore::RESTORE_TIMEOUT;
    assert_eq!(state.next_restore(1, normal(), expired), Some(Action::Fail));
    assert!(state.pending_restore.is_none());
    let intermediate = Bounds {
      size: (1600, 1200),
      position: (0, 0),
    };
    state.capture_bounds(
      Observation {
        size: Some(intermediate.size),
        ..normal()
      },
      intermediate,
      flags(),
      expired,
    );
    assert_eq!(
      (state.width, state.height, state.x, state.y),
      (720, 480, 220, 180)
    );
    let settled = Bounds {
      size: (720, 480),
      position: (300, 240),
    };
    state.capture_bounds(normal(), settled, flags(), expired + NORMAL_SETTLE);
    assert_eq!((state.x, state.y), (220, 180));
    state.capture_bounds(normal(), settled, flags(), expired + NORMAL_SETTLE * 2);
    assert_eq!((state.x, state.y), (300, 240));
    assert!(!state.protect_geometry);
  }

  #[test]
  fn fresh_normal_position_initializes_previous_fields_and_legacy_maximized_position_restores() {
    let mut state = WindowState::default();
    state.remember_position((140, 140));
    state.maximized = true;
    assert_eq!(state.restore_position(), (140, 140));
    let legacy = WindowState {
      x: 0,
      y: 0,
      prev_x: 220,
      prev_y: 180,
      maximized: true,
      ..saved()
    };
    assert_eq!(legacy.restore_position(), (220, 180));
  }

  #[test]
  fn pending_restore_is_not_persisted_and_normal_bounds_survive() {
    let state = WindowState {
      width: 720,
      height: 480,
      x: 220,
      y: 180,
      fullscreen: true,
      pending_restore: Some(Attempt::new(1, (720, 480), true, true, Instant::now())),
      protect_geometry: true,
      ..WindowState::default()
    };
    let json = serde_json::to_value(&state).unwrap();
    assert!(json.get("pending_restore").is_none());
    assert!(json.get("protect_geometry").is_none());
    assert!(json.get("normal_candidate").is_none());
    let restored: WindowState = serde_json::from_value(json).unwrap();
    assert!(restored.pending_restore.is_none());
    assert!(!restored.protect_geometry);
    assert!(restored.fullscreen);
    assert_eq!(
      (restored.width, restored.height, restored.x, restored.y),
      (720, 480, 220, 180)
    );
  }

  #[test]
  fn captures_only_confirmed_normal_window_geometry() {
    for (fullscreen, maximized, minimized, expected) in [
      (Some(false), false, false, true),
      (Some(false), true, false, false),
      (Some(false), false, true, false),
      (Some(false), true, true, false),
      (Some(true), false, false, false),
      (Some(true), true, false, false),
      (Some(true), false, true, false),
      (Some(true), true, true, false),
      (None, false, false, false),
      (None, true, false, false),
      (None, false, true, false),
      (None, true, true, false),
    ] {
      assert_eq!(
        Observation {
          fullscreen,
          maximized: Some(maximized),
          minimized: Some(minimized),
          size: None
        }
        .normal(),
        expected,
        "fullscreen={fullscreen:?}, maximized={maximized}, minimized={minimized}"
      );
    }
  }
}
