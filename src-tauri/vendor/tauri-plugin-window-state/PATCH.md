# Local native window-state correction

Upstream: `tauri-plugin-window-state` version `2.4.0`, published on crates.io from https://github.com/tauri-apps/plugins-workspace.

The upstream plugin saves fullscreen monitor bounds as normal window bounds on Linux/Muffin. Closing a 720 × 480 window in fullscreen saved 3840 × 2160 bounds, so leaving fullscreen after relaunch did not restore the original windowed geometry.

Local changes prevent geometry capture while maximized or fullscreen in close/exit snapshots and move/resize event handlers. The plugin still owns its existing state file and native lifecycle hooks. Geometry capture requires confirmed normal fullscreen/maximized/minimized observations; failed queries retain cached modes and bounds. Normal position updates keep the previous-position fields consistent, fixing the first maximized restart losing the initial normal position.

The pure policy in `src/restore.rs` coordinates normal size → confirmed maximization → fullscreen. Each attempt has an in-memory identity and a two-second overall deadline. Native events and a bounded 50 ms poll advance the same controller; there is no separate callback per mode. Stable usable constrained geometry can advance after one second, without bypassing mode confirmation. Unknown observations or unconfirmed modes at deadline terminate the attempt. Failed requests, close, and supersession invalidate old callbacks. Setters run outside the cache lock.

Pending phases, identities, geometry protection, and settlement samples are not serialized. Geometry stays protected after failure until confirmed normal samples settle. The cached maximized mode represents the non-fullscreen mode selected before fullscreen, even on platforms that hide maximization while fullscreen. Native restart tests exercise all mode combinations; deterministic tests cover ordering, deadline/failure handling, unknown observations, late callbacks, previous-position compatibility, and serialization.

The app selects this crate with a Cargo `[patch.crates-io]` override. Keep the patch until an upstream release provides equivalent fullscreen-aware geometry preservation and passes the native lifecycle checks. Upstream MIT and Apache-2.0 licenses are retained.
