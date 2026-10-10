// Copyright 2019-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT
// Local native-mode restoration policy; see ../PATCH.md.

use std::time::{Duration, Instant};

pub(crate) const RESTORE_TIMEOUT: Duration = Duration::from_secs(2);
pub(crate) const RESTORE_POLL: Duration = Duration::from_millis(50);
const GEOMETRY_SETTLE: Duration = Duration::from_secs(1);
pub(crate) const NORMAL_SETTLE: Duration = Duration::from_millis(100);

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub(crate) struct Observation {
  pub size: Option<(u32, u32)>,
  pub maximized: Option<bool>,
  pub fullscreen: Option<bool>,
  pub minimized: Option<bool>,
}

impl Observation {
  pub fn normal(self) -> bool {
    self.maximized == Some(false) && self.fullscreen == Some(false) && self.minimized == Some(false)
  }

  pub fn usable_size(self) -> bool {
    matches!(self.size, Some((width, height)) if width > 0 && height > 0)
  }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Phase {
  Geometry,
  Maximized,
  Fullscreen,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Action {
  Wait,
  Maximize(bool),
  Fullscreen(bool),
  Complete,
  Fail,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Attempt {
  pub id: u64,
  pub clamped: bool,
  size: (u32, u32),
  maximized: bool,
  fullscreen: bool,
  phase: Phase,
  issued: bool,
  started: Instant,
  stable_size: Option<((u32, u32), Instant)>,
}

impl Attempt {
  pub fn new(id: u64, size: (u32, u32), maximized: bool, fullscreen: bool, now: Instant) -> Self {
    Self {
      id,
      size,
      maximized,
      fullscreen,
      started: now,
      phase: Phase::Geometry,
      issued: false,
      clamped: false,
      stable_size: None,
    }
  }

  pub fn next(&mut self, observed: Observation, now: Instant) -> Action {
    let expired = now.duration_since(self.started) >= RESTORE_TIMEOUT;
    match self.phase {
      Phase::Geometry => {
        // A mode selected before we issued any mode request supersedes startup restore.
        if observed.maximized == Some(true) || observed.fullscreen == Some(true) {
          return Action::Fail;
        }
        if !observed.normal() || !observed.usable_size() {
          return if expired { Action::Fail } else { Action::Wait };
        }
        let size = observed.size.unwrap();
        let stable_since = match self.stable_size {
          Some((previous, since)) if previous == size => since,
          _ => {
            self.stable_size = Some((size, now));
            now
          }
        };
        if size != self.size {
          if expired {
            return Action::Fail;
          }
          if now.duration_since(self.started) < GEOMETRY_SETTLE
            || now.duration_since(stable_since) < NORMAL_SETTLE
          {
            return Action::Wait;
          }
          self.clamped = true;
        }
        self.phase = Phase::Maximized;
        self.next(observed, now)
      }
      Phase::Maximized => {
        if observed.fullscreen == Some(true) {
          return Action::Fail;
        }
        if observed.maximized == Some(self.maximized) && observed.minimized == Some(false) {
          self.phase = Phase::Fullscreen;
          self.issued = false;
          return self.next(observed, now);
        }
        if expired {
          return Action::Fail;
        }
        if !self.issued
          && observed.maximized.is_some()
          && observed.fullscreen == Some(false)
          && observed.minimized == Some(false)
        {
          self.issued = true;
          return Action::Maximize(self.maximized);
        }
        Action::Wait
      }
      Phase::Fullscreen => {
        if observed.fullscreen == Some(false)
          && observed
            .maximized
            .is_some_and(|maximized| maximized != self.maximized)
        {
          return Action::Fail;
        }
        if observed.fullscreen == Some(self.fullscreen)
          && observed.minimized == Some(false)
          && (observed.fullscreen == Some(true) || observed.maximized == Some(self.maximized))
        {
          return Action::Complete;
        }
        if expired {
          return Action::Fail;
        }
        if !self.issued
          && observed.fullscreen.is_some()
          && observed.maximized == Some(self.maximized)
          && observed.minimized == Some(false)
        {
          self.issued = true;
          return Action::Fullscreen(self.fullscreen);
        }
        Action::Wait
      }
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn normal(size: (u32, u32)) -> Observation {
    Observation {
      size: Some(size),
      maximized: Some(false),
      fullscreen: Some(false),
      minimized: Some(false),
    }
  }

  #[test]
  fn coordinates_all_requested_modes_from_applied_normal_bounds() {
    for (maximized, fullscreen) in [(false, false), (true, false), (false, true), (true, true)] {
      let now = Instant::now();
      let mut attempt = Attempt::new(1, (720, 480), maximized, fullscreen, now);
      let mut observed = normal((720, 480));
      if maximized {
        assert_eq!(attempt.next(observed, now), Action::Maximize(true));
        assert_eq!(attempt.next(observed, now), Action::Wait);
        observed.maximized = Some(true);
      }
      if fullscreen {
        assert_eq!(attempt.next(observed, now), Action::Fullscreen(true));
        observed.fullscreen = Some(true);
        // Platforms may hide the underlying maximized mode while fullscreen.
        observed.maximized = Some(false);
      }
      assert_eq!(attempt.next(observed, now), Action::Complete);
    }
  }

  #[test]
  fn cannot_enter_fullscreen_after_unconfirmed_maximization_at_deadline() {
    let now = Instant::now();
    let mut attempt = Attempt::new(1, (720, 480), true, true, now);
    let observed = normal((720, 480));
    assert_eq!(attempt.next(observed, now), Action::Maximize(true));
    assert_eq!(attempt.next(observed, now + RESTORE_TIMEOUT), Action::Fail);
  }

  #[test]
  fn accepts_stable_constrained_bounds_but_still_waits_for_maximization() {
    let now = Instant::now();
    let mut attempt = Attempt::new(1, (9000, 9000), true, true, now);
    let observed = normal((1280, 720));
    assert_eq!(attempt.next(observed, now), Action::Wait);
    assert_eq!(
      attempt.next(observed, now + GEOMETRY_SETTLE),
      Action::Maximize(true)
    );
    assert!(attempt.clamped);
    assert_eq!(attempt.next(observed, now + GEOMETRY_SETTLE), Action::Wait);
    assert_eq!(
      attempt.next(
        Observation {
          maximized: Some(true),
          ..observed
        },
        now + GEOMETRY_SETTLE
      ),
      Action::Fullscreen(true)
    );
  }

  #[test]
  fn unknown_modes_do_not_issue_requests_and_expire() {
    for unknown in 0..3 {
      let now = Instant::now();
      let mut attempt = Attempt::new(1, (720, 480), true, true, now);
      let mut observed = normal((720, 480));
      match unknown {
        0 => observed.fullscreen = None,
        1 => observed.maximized = None,
        _ => observed.minimized = None,
      }
      assert_eq!(attempt.next(observed, now), Action::Wait);
      assert_eq!(attempt.next(observed, now + RESTORE_TIMEOUT), Action::Fail);
    }
  }

  #[test]
  fn explicit_mode_change_during_geometry_wait_supersedes_restore() {
    let now = Instant::now();
    let mut attempt = Attempt::new(1, (720, 480), false, true, now);
    assert_eq!(
      attempt.next(
        Observation {
          maximized: Some(true),
          ..normal((1600, 1200))
        },
        now
      ),
      Action::Fail
    );
  }
}
