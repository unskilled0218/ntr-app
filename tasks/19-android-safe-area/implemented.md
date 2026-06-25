# 19 - Android safe area — implemented

Implemented exactly as planned. One file changed for the feature
(`src/style.css`); no `.tsx`, no `src-tauri/`, no Android resource change. The
Android prerequisites were already present and untouched:
`MainActivity.enableEdgeToEdge()` and `<meta viewport-fit=cover>` in `index.html`.

## Changes

`src/style.css`:

1. `:root` — added four inset variables, each with a `0px` fallback so the layout
   is byte-identical where there is no inset:
   `--safe-top/right/bottom/left: env(safe-area-inset-*, 0px)`.
2. `main` — replaced `padding: 2rem 1rem` with per-side
   `max(designGutter, var(--safe-*))` (top/right/bottom/left). The mobile
   `@media (max-width: 720px)` `padding-bottom: 0` override is unchanged, so on
   mobile the bottom edge is owned by the nav, not `main`.
3. `.settings-btn` — `top`/`right` now `calc(var(--safe-*) + originalOffset)`, so
   the absolutely-positioned chip clears the status bar and a right-side cutout
   (absolute offsets are from the padding-box edge, which padding does not move).
4. `.bottom-nav` (inside the mobile `@media` block) — added
   `padding-bottom: var(--safe-bottom)` so the bar's fill reaches the screen edge
   while the Note/Todo buttons sit above the gesture bar.

`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
`src-tauri/Cargo.lock`: version 0.7.0 -> 0.8.0.

## Verification

- `npm run build` (tsc + vite): passes; bundles `index-*.css` (7.66 kB). Version
  shows `ntr@0.8.0`.
- `npm test`: 20 files, 145 tests, all pass (no logic touched).
- Off-device the `max()`/`calc()` collapse to today's exact `2rem`/`1rem`/`0.5rem`
  /`0.75rem` values, so desktop/web layout is unchanged.
