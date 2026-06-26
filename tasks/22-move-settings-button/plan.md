# 22 - Move the settings button into a title row (desktop) / the bottom nav (mobile)

## Goal

Today the connection-settings control is a single `<button class="settings-btn">`
that floats `position: absolute` in the top-right corner of `<main>`, over the
panes (App.tsx:128-135, style.css:633-650). It shows `[S]` (a server URL is set) or
`[L]` (local mode) as a mode badge. Move it out of the floating corner into the
app's layout:

- **Desktop:** a real title row at the top of the app — the app wordmark on the
  left and the settings badge on the right, in one line, above the panes.
- **Mobile:** the title row is not shown (single-pane mode keeps its vertical space,
  as task 21 established); the settings control moves into the bottom nav as a
  compact trailing button after Note / Todo, chosen layout: `Note | Todo | [S]` with
  Note/Todo the two equal segments and the settings badge compact at the right.

The badge text (`[S]`/`[L]`) and what the control does (open `SettingsModal`) do not
change — only where it lives and how it is laid out.

## The single new idea: one control, two layout slots — single-sourced

The settings control must appear in two different layout regions (the desktop title
row at the top, the mobile bottom bar) that live at opposite ends of `<main>`. A
single DOM node cannot be in two parents, and **which** region is active is a
viewport-breakpoint decision — which this codebase keeps in CSS only (the
`.bottom-nav` comment, style.css:88-90, makes CSS the single home of the 720px
breakpoint, and `onMobile()` reads the nav's computed `display` rather than
re-encoding it, App.tsx:99-101).

So the right shape is: render the control in **both** slots and let the existing
media query show exactly one (the same mechanism that already shows one pane / the
bottom nav per breakpoint), and **single-source the control itself** as one small
component so the "two slots" is layout-only, not a duplicated decision.

### Why a `SettingsButton` component, not inline JSX twice

Inlining the button markup in both slots would copy three coupled decisions — the
`[S]`/`[L]` mode-badge rule, the `aria-label`, and the click target — into two
places (Knowledge Duplication, R3: one decision, two homes that must change
together). A single `SettingsButton` puts that decision in one file; each slot is
then just `<SettingsButton onOpen={...} className={...} />`. The component owns the
mode→badge rule (reads `getServerUrl()` and renders `[S]`/`[L]`), so even the badge
logic — currently an inline ternary in App (App.tsx:134) — gets one home. This is
not speculative generality: it has exactly two real call sites today and removes a
real duplication; it is the smallest unit that makes "render the settings control"
a single expression.

### Why not a single instance repositioned with `position: fixed`

A lone fixed-position button moved by a media query (top-right on desktop,
bottom-right on mobile) would be one instance, but on mobile it would float *over*
the bottom nav's Todo half rather than sit *in* the bar as a flow item — the chosen
`Note | Todo | [S]` layout needs the badge to be a flex sibling of the nav buttons,
not an overlay. Two in-flow instances in two flex containers give the requested
layout on both breakpoints; a fixed overlay does not.

## The component — `src/components/SettingsButton.tsx` (new)

Colocated with the other components. Minimal, presentation-only:

```tsx
import { getServerUrl } from "../settings";

// The connection-settings control: a small badge that shows [S] when a server URL is configured
// (server mode) or [L] otherwise (local mode), and opens the SettingsModal when clicked. Rendered
// in two layout slots — the desktop title row and the mobile bottom nav — so the mode-badge rule,
// the label, and the click target live here once; the two slots are addressed by their containers
// in CSS (`.settings-btn` / `.bottom-nav .settings-btn`), so the component needs no per-slot prop.
export default function SettingsButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button type="button" className="settings-btn" aria-label="Connection settings" onClick={onOpen}>
      {getServerUrl() ? "[S]" : "[L]"}
    </button>
  );
}
```

(Round-1 review: dropped a speculative `className` prop — each slot is reachable
through its container selector, so no per-slot class is needed.)

It reads `getServerUrl()` on render. App already re-renders after the settings modal
closes (`onSettingsClose` sets state, App.tsx:90-97), so both instances re-read and
the badge stays correct after a mode change — identical to today's behaviour, where
App re-reads `getServerUrl()` per render (App.tsx:124).

## App.tsx changes

- **Remove** the floating button (App.tsx:128-135) and the now-unused
  `const serverUrl = getServerUrl()` (App.tsx:124) — `getServerUrl` is no longer
  imported by App; the badge logic moved into `SettingsButton`. (Keep the
  `getCompactUi` / settings imports App still uses.)
- **Hoist the open-settings callback once** (round-1 review: it was duplicated at
  both slots), near the other handlers:

  ```tsx
  const openSettings = () => setSettingsOpen(true);
  ```

- **Add** a desktop title row as the first child of `<main>`, above `.panes`:

  ```tsx
  <header className="app-header">
    <span className="app-title">ntr</span>
    <SettingsButton onOpen={openSettings} />
  </header>
  ```

  The wordmark is `ntr` (the product name — `index.html` `<title>`, tauri
  `productName`), lowercase to match the `note`/`todo` pane titles. It is a `<span>`,
  not an `<h1>`: the panes already own the page's `<h1>`s, and adding a third
  competing `<h1>` would muddy the heading outline; the wordmark is branding chrome,
  not a document heading. `.app-header` is hidden on mobile (below), so the wordmark
  is desktop-only and costs no mobile vertical space.

- **Add** the same control as a compact trailing item inside the existing
  `<nav className="bottom-nav">`, after the `VIEWS.map(...)` view buttons:

  ```tsx
  <SettingsButton onOpen={openSettings} />
  ```

  It is placed **after** the mapped view buttons and carries no `data-view` / is not
  in `VIEWS`, so the "button order must match VIEWS" invariant (the swipe
  source-of-truth, App.tsx:142-143) is untouched — swipe still reads `VIEWS` only,
  and the first N nav buttons still correspond to `VIEWS`. The comment there is
  updated to note the trailing settings button is exempt.

`navRef` stays on the `<nav>`, so the `onMobile()` breakpoint oracle (App.tsx:101)
is unchanged. No change to swipe, the live-change wiring, or the modal.

### Accessibility note (kept deliberately)

The settings button sits inside `<nav aria-label="Switch view">` on mobile. It keeps
its own `aria-label="Connection settings"`, so it is clearly named for assistive
tech even though it is not a view switch. Splitting the bar into two landmarks to
keep the nav "pure" would complicate the `navRef`-based breakpoint oracle and the
edge-to-edge nav styling for no real user gain; one extra, self-labelled control in
the bar is the accepted trade-off.

## style.css changes

1. **Rework `.settings-btn` (style.css:633-650): drop all positioning, keep only the
   badge look.** It no longer floats; its container positions it.

   ```css
   /* Connection-mode badge: [S] (server) or [L] (local). Positioned by its container —
      the desktop .app-header or the mobile .bottom-nav — not by itself. */
   .settings-btn {
     padding: 0.2rem 0.45rem;
     font-size: 0.75rem;
     font-family: ui-monospace, monospace;
     border: 1px solid var(--border);
     border-radius: 4px;
     background: #fff;
     color: var(--muted);
     cursor: pointer;
   }
   ```

   Removed: `position: absolute`, the `top`/`right` safe-area `calc()`s, `z-index`.
   The desktop badge no longer needs its own inset math — it lives inside `<main>`,
   which already pads for `--safe-top` / `--safe-right` (style.css:55-56).

2. **Add the title row:**

   ```css
   /* The desktop title row: app wordmark left, connection badge right, one line above the
      panes. Hidden on mobile, where the badge moves into the bottom nav. */
   .app-header {
     display: flex;
     align-items: center;
     justify-content: space-between;
     margin-bottom: 1rem;
   }
   .app-title {
     font-size: 1.5rem;
     font-weight: 600;
     color: var(--fg);
   }
   ```

   `.app-header` is a normal (non-growing) flex child of the `main` column, so it
   takes one row at the top and `.panes` (flex: 1) keeps the rest.

3. **Mobile (`@media (max-width: 720px)`):** hide the title row and make the nav's
   settings button compact rather than an equal segment.

   ```css
   .app-header {
     display: none;
   }
   /* The settings badge is a compact trailing item, not a third equal segment: Note/Todo keep
      their flex: 1 halves; this sits to their right at its natural width. */
   .bottom-nav .settings-btn {
     flex: 0 0 auto;
   }
   ```

   Inside the bar the badge inherits `.bottom-nav button` (style.css:128-136:
   borderless, plain, muted, `padding: 0.75rem`), so it reads as a compact `[S]`/`[L]`
   text button consistent with Note/Todo, just narrower (content width via
   `flex: 0 0 auto`, which out-specifies the `flex: 1` from `.bottom-nav button`). It
   never gets `is-active` (not a view), so it stays muted. No extra styling needed.

4. **Doc sync — `:root` comment (style.css:13-16):** that comment lists "the settings
   button" among the elements that consume safe-area insets. After (1) it no longer
   does (its containers do), so drop it from the list to keep the comment true.

## Tests

- **`src/components/SettingsButton.test.tsx` (new).** Real `localStorage` (jsdom),
  no mock needed — the component's only logic is the mode→badge read:
  1. With no server URL set → renders `[L]`.
  2. After `setServerUrl("https://x")` → renders `[S]`.
  3. Clicking it calls the `onOpen` prop once.
  This covers the one piece of behaviour the refactor introduces a single home for.
- **No App test** is added (none exists today; App is the layout shell). The
  desktop-vs-mobile *placement* is a media-query/layout concern that jsdom does not
  evaluate, so it has no meaningful unit assertion — consistent with the rest of the
  single-pane CSS and with task 21.
- All existing suites stay green: no component other than App changes, and App has no
  test that referenced the old floating button.

## Verification

- `npm run build` (tsc + vite) — type-checks the new component and its two call
  sites; bundles at ntr@0.11.0.
- `npm test` — existing 150 tests stay green; the new `SettingsButton` suite passes.
- Manual:
  - Desktop (≥720px): a title row shows `ntr` on the left and the `[S]`/`[L]` badge
    on the right, above the panes; clicking the badge opens Settings; no floating
    corner button remains. The badge reflects the mode and updates after changing it.
  - Mobile (≤720px): no title row; the bottom bar shows `Note | Todo` as equal halves
    with a compact `[S]`/`[L]` button at the right that opens Settings; swiping still
    switches Note/Todo.

## Out of scope

- **No change to what Settings contains or does** — only the trigger's location.
- **No JS breakpoint** — placement is by the existing media query; adding
  `matchMedia` would duplicate the 720px threshold CSS already owns.
- **No pane-title or heading-level rework** — pane titles stay `<h1>`; the wordmark is
  a non-heading `<span>` to avoid a third `<h1>`. Restructuring the heading outline is
  a separate concern.
- **No second nav landmark** — the self-labelled settings button stays inside the
  existing `<nav>` (rationale above).
