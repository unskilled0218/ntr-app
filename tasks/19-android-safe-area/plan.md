# 19 - Android safe area (respect system-bar insets so nothing hides behind them)

## Goal

On Android the app draws **edge-to-edge** (`MainActivity.enableEdgeToEdge()`,
present since the initial scaffold) and the viewport already opts in with
`viewport-fit=cover` (`index.html`). That means the WebView paints under the
**status bar** (top), the **navigation / gesture bar** (bottom), and any **display
cutout** (left/right in landscape) — but the CSS never reads the resulting
`env(safe-area-inset-*)` values, so two controls land in the unsafe zone:

```
Top status bar      -> the [S]/[L] settings button (top: 0.5rem) sits UNDER it
Bottom gesture bar  -> the mobile bottom-nav (Note | Todo) sits UNDER it
Landscape cutout    -> main's 1rem gutter is too small to clear a side notch
```

Make the layout respect the safe area: keep every interactive element out from
under the system bars, while letting the background still extend edge-to-edge
(the edge-to-edge look is intentional — only *content* must stay clear).

## What is already in place (so this task does not touch it)

- `index.html` already has `<meta name="viewport" ... viewport-fit=cover>` — the
  prerequisite for `env(safe-area-inset-*)` to report non-zero. No change.
- `MainActivity.kt` already calls `enableEdgeToEdge()` — the WebView already draws
  behind the bars. No Kotlin/Android change.

So the gap is purely **CSS consuming the insets**. This task is one file:
`src/style.css`. No `.tsx`, no `src-tauri/`, no Android resource change.

## Design — name the inset once, consume it only at the screen-edge elements

### One home for the concept: four `:root` variables

`env(safe-area-inset-*)` is the new idea; capture it once as named custom
properties at the top of `style.css` (beside the existing `:root` palette), each
with a `0px` fallback so non-cutout platforms (desktop, older WebViews) collapse
to today's exact layout:

```css
:root {
  /* System-bar / display-cutout insets, exposed by viewport-fit=cover on Android
     edge-to-edge. 0px everywhere there is no inset (desktop, no cutout), so the
     layout below is unchanged off-device. Named once; consumed only at the few
     elements that touch a screen edge. */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-right: env(safe-area-inset-right, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --safe-left: env(safe-area-inset-left, 0px);
}
```

Every consumer below reads `var(--safe-*)`, so the `env()` call — the one
platform-specific token — exists in exactly one place. If the inset source ever
changes, it changes here only.

### Where each edge is cleared (one rule per screen-edge element)

Only three things touch a screen edge: the `main` content box, the absolutely
positioned settings button, and the mobile bottom-nav. Each clears its own edge;
nothing else changes.

| Edge / element | Today | Change |
|---|---|---|
| `main` top/left/right gutter | `padding: 2rem 1rem` | grow each side to clear its inset (see below) |
| `main` bottom gutter (desktop) | part of `padding: 2rem 1rem` | `padding-bottom: max(2rem, var(--safe-bottom))` |
| `main` bottom gutter (mobile) | `padding-bottom: 0` (nav flush) | **unchanged** — the nav carries the bottom inset instead |
| `.settings-btn` (top-right, `position: absolute`) | `top: 0.5rem; right: 0.75rem` | offset by the inset so it clears the status bar / side cutout |
| `.bottom-nav` (mobile, flush to bottom) | no bottom padding | `padding-bottom: var(--safe-bottom)` so its background fills to the edge but the buttons sit above the gesture bar |

#### `main` — grow the gutter, don't add a second one

`main`'s `padding: 2rem 1rem` shorthand is replaced with explicit per-side
padding using `max(designGutter, inset)`:

```css
main {
  /* was: padding: 2rem 1rem; — now each side is at least the design gutter and
     grows to clear its safe-area inset (max, not sum: the inset already includes
     the bar depth, so we don't stack a second full gutter on top of it). */
  padding-top: max(2rem, var(--safe-top));
  padding-right: max(1rem, var(--safe-right));
  padding-bottom: max(2rem, var(--safe-bottom));
  padding-left: max(1rem, var(--safe-left));
  /* ... existing max-width / margin / height: 100dvh / flex rules unchanged ... */
}
```

`max()` (not `calc(gutter + inset)`) because the inset is measured from the screen
edge and already covers the bar; adding the full 2rem on top would waste space.
Where there is no inset (`0px`), `max(2rem, 0px)` = `2rem` — identical to today.

The mobile `@media (max-width: 720px)` rule keeps its existing
`main { padding-bottom: 0; }` override (the bottom-nav is meant to be flush there),
so on mobile the bottom inset is **not** applied to `main` — it is applied to the
nav instead (next item). This keeps the "one source of truth for the bottom edge"
clean: desktop -> `main`, mobile -> `.bottom-nav`.

#### `.settings-btn` — offset, because absolute positioning ignores padding

The button is `position: absolute` against `main`, so its `top`/`right` are
measured from `main`'s padding-box edge (the screen edge) and the new `main`
padding does **not** push it inward. It must add the inset itself:

```css
.settings-btn {
  /* was: top: 0.5rem; right: 0.75rem; — absolute offsets are from the padding-box
     edge (the screen edge under edge-to-edge), so add the inset to clear the
     status bar (top) and any right-side cutout. */
  top: calc(var(--safe-top) + 0.5rem);
  right: calc(var(--safe-right) + 0.75rem);
  /* ... existing padding / font / border / background / z-index unchanged ... */
}
```

`calc(inset + 0.5rem)` (sum, not max) here on purpose: the button is a small
free-floating chip, so it should keep its full 0.5rem gap *below* the bar, not
butt against it. With no inset this is `calc(0px + 0.5rem)` = `0.5rem` — unchanged.

#### `.bottom-nav` — reserve the gesture-bar depth inside the bar

```css
.bottom-nav {
  /* (inside the existing @media max-width:720px block, where the bar is shown)
     Sit flush to the bottom edge but reserve the gesture-bar depth as bottom
     padding: the white background + top border reach the screen edge while the
     Note/Todo buttons stay above the gesture bar. */
  padding-bottom: var(--safe-bottom);
}
```

The nav's buttons keep their own `padding: 0.75rem`; this adds the inset *below*
them, so the tappable targets clear the gesture bar and the bar's fill still
reaches the edge (the edge-to-edge look is preserved, only the buttons move up).

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| Name the safe-area insets | `src/style.css` `:root` | Add four `--safe-*` vars |
| Clear the top/side/bottom content gutter | `src/style.css` `main` | Shorthand -> per-side `max(gutter, inset)` |
| Keep the settings chip below the bars | `src/style.css` `.settings-btn` | `top`/`right` add the inset |
| Keep the mobile nav above the gesture bar | `src/style.css` `.bottom-nav` (mobile) | `padding-bottom: var(--safe-bottom)` |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.7.0 -> 0.8.0 (done) |

No JS/TS, no component, no `src-tauri/`, no Android resource change.

## Why no automated test

Every existing suite is vitest + jsdom over **TypeScript logic** (settings,
config, api, components). This change adds **no** TS — it is four CSS rules reading
`env()`. jsdom does not compute layout, does not resolve `env()`/`max()`/`calc()`,
and reports no geometry, so a unit test could only re-state the stylesheet text
(a change-detector test, which xUnit Test Patterns warns against). The behaviour
is layout under real device insets, which only a device/emulator exercises. So,
consistent with how task 18's pure-CSS additions were handled, verification is
build + manual, below. No test file is added, and none is removed.

## Verification

- `npm run build` (tsc + vite) — confirms the stylesheet still bundles and nothing
  else regressed (no TS touched, so this is a sanity build).
- `npm test` — unchanged suites still green (no logic touched).
- Manual, desktop browser: layout is **pixel-identical** to before — all
  `--safe-*` resolve to `0px`, so `max(2rem, 0px)` / `calc(0px + 0.5rem)` reproduce
  today's values. The settings button, panes, and (under 720px) the bottom nav are
  where they are now.
- Manual, Android device/emulator (portrait): the [S]/[L] button sits fully below
  the status bar; the Note/Todo nav sits fully above the gesture pill; the bar's
  white fill still reaches the screen bottom.
- Manual, Android landscape with a cutout: content clears the side notch (gutter
  grows on the notch side); the settings button clears a right-side cutout.

## Out of scope

- **No Android / Kotlin / manifest / theme change** — edge-to-edge and
  `viewport-fit=cover` are already in place; only CSS was missing.
- **No new setting / toggle** — safe-area clearance is unconditional and correct
  on every platform (it is a no-op where there is no inset), so it needs no opt-in.
- **Centered modals/dialogs are not inset-padded** — they are UA-centered within
  the viewport and do not pin to an edge, so they already avoid the bars; adding
  inset math to each `<dialog>` would be clutter for no observed overlap.
- **No status-bar colour / icon-contrast theming** — that is a separate Android
  styling concern, not safe-area geometry.
