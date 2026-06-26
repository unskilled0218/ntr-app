# 22 - Implemented

Implements the plan as refined by `plan-review.md` (no `className` prop; one hoisted
`openSettings`). The floating corner button is gone; the settings control now lives
in a desktop title row and in the mobile bottom nav.

## New file — `src/components/SettingsButton.tsx`

One presentation-only component, single home for the mode→badge rule, the
`aria-label`, and the click target:

```tsx
import { getServerUrl } from "../settings";

export default function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="settings-btn" aria-label="Connection settings" onClick={onOpen}>
      {getServerUrl() ? "[S]" : "[L]"}
    </button>
  );
}
```

No `className` prop: each slot is reached through its container selector
(`.settings-btn` on desktop, `.bottom-nav .settings-btn` on mobile).

## `src/App.tsx`

- Dropped the `getServerUrl` import (now only `getCompactUi` from settings) and the
  floating `<button class="settings-btn">` plus the `const serverUrl = ...` line.
- Added `import SettingsButton from "./components/SettingsButton"`.
- Hoisted `const openSettings = () => setSettingsOpen(true)` and used it at both slots.
- Added the desktop title row as the first child of `<main>`:
  `<header className="app-header"><span className="app-title">ntr</span><SettingsButton onOpen={openSettings} /></header>`.
- Added `<SettingsButton onOpen={openSettings} />` as the trailing child of the
  existing `<nav className="bottom-nav">`, after the `VIEWS.map(...)` view buttons.
  Updated the nav comment to note the trailing badge is not a view and does not
  affect swipe. `navRef`, swipe, and the live-change wiring are unchanged.

## `src/style.css`

- `.settings-btn`: removed `position: absolute`, the `top`/`right` safe-area
  `calc()`s, and `z-index` — kept only the badge look (border, padding, mono font,
  bg, colour). Its container now positions it.
- Added `.app-header` (flex row, `space-between`, `margin-bottom: 1rem`) and
  `.app-title` (1.5rem, 600, `--fg`), placed after the `h1` rule.
- In `@media (max-width: 720px)`: `.app-header { display: none }` (title row is
  desktop-only); `.bottom-nav .settings-btn { flex: 0 0 auto }` so the badge is a
  compact trailing item while Note/Todo keep their `flex: 1` halves. Inside the bar
  it inherits the plain, borderless `.bottom-nav button` look and never gets
  `is-active`.
- `:root` comment: dropped "the settings button" from the list of safe-area-inset
  consumers (it no longer reads insets; its containers do).

## Version

Bumped 0.10.0 -> 0.11.0 in `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`.

## Tests

- New `src/components/SettingsButton.test.tsx`: `[L]` in local mode, `[S]` after
  `setServerUrl(...)`, and `onOpen` fires on click (real jsdom `localStorage`, no
  mock). No App test (none exists; placement is media-query layout jsdom does not
  evaluate).

## Verification

- `npm run build` — clean, ntr@0.11.0 (59 modules; CSS 8.03 kB).
- `npm test` — 21 files, 153 tests pass (was 150; +3 from the new suite).
- Manual (to confirm on device/narrow window): desktop shows the `ntr` + `[S]`/`[L]`
  title row above the panes and no corner button; mobile shows `Note | Todo` equal
  halves with a compact `[S]`/`[L]` button trailing, and swipe still switches views.
