# Local fullscreen geometry correction

Upstream: `tauri-plugin-window-state` version `2.4.0`, published on crates.io from https://github.com/tauri-apps/plugins-workspace.

The upstream plugin saves fullscreen monitor bounds as normal window bounds on Linux/Muffin. Closing a 720 × 480 window in fullscreen saved 3840 × 2160 bounds, so leaving fullscreen after relaunch did not restore the original windowed geometry.

Local changes prevent geometry capture while fullscreen in close/exit snapshots and move/resize event handlers. The plugin still owns its existing state file, fullscreen flag, lifecycle hooks, and restore order. Failed fullscreen queries do not allow geometry writes. Focused tests cover the capture policy.

Restored fullscreen also waits for the saved physical size to be applied when native sizing is asynchronous. A per-window, nonserialized pending marker blocks intermediate geometry samples until the matching resize event enters fullscreen. This avoids GTK retaining its initial default size as the post-fullscreen windowed size. Already-applied sizes retain the direct restore path.

The app selects this crate with a Cargo `[patch.crates-io]` override. Keep the patch until an upstream release provides equivalent fullscreen-aware geometry preservation and passes the native lifecycle checks. Upstream MIT and Apache-2.0 licenses are retained.
