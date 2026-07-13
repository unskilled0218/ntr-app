# 26 - Startup page setting for mobile view

## Goal

Add a **setting** that chooses which pane opens first: **note**, **todo**, or
**last opened** (whatever pane was showing when the app was last closed). It
lives in the existing Settings modal's "Display" section, beside "Compact
controls", as a picker defaulting to **Note** — the app's current hardcoded
behaviour.

This only has a visible effect on mobile: `view` already exists today
(`src/App.tsx:25`) purely to drive the single-pane mobile layout (`<main
data-view={view}>`, `src/style.css:114-131`) — on desktop both panes render
side by side regardless of `view` (`.panes` is a two-column flex row above the
720px breakpoint). So this task only changes **what `view` is seeded with on
mount**; nothing about desktop layout, the bottom-nav, or swipe changes.

Today `view` is `useState<View>("note")` — a literal, never persisted, reset
on every launch (`App.tsx:25`). There is also no existing memory of "the last
view the user had open"; that has to be added to support the "last opened"
choice.

## The single idea: two settings, not one — a preference, and a running cache it can point at

"Startup page" is a **user preference** (note / todo / last), exactly the
same category as `compactUi` or `conflictStrategy`: it lives in
`src/settings.ts`, the module that owns every `localStorage`-backed
preference behind `getX`/`setX` pairs, default represented by the absence of
the key (the file's established idiom — see `getConflictStrategy`,
`settings.ts:47-55`).

"Last opened" is a second, different thing: not a preference the user sets
directly, but a **continuously-updated cache** of the current view, kept only
so the "last opened" preference has something to read. It needs its own
key (`ntr.lastView`) and its own get/set pair, written every time the view
changes — independent of whether "last opened" is even the active startup
setting today, so switching *to* "last opened" later already has a sensible
value instead of a cold start.

Keeping these as two pairs (rather than one "smart" getter that also writes)
matches task 24's settings/component split: `settings.ts` owns storage
shape and validation; the call site (`App.tsx`) owns *when* a write happens.

## Where each concern lives

| Concern | Home | Change |
|---|---|---|
| Startup-page preference (read/write) | `src/settings.ts` | Add `get/setStartupView`, type `StartupView` |
| Last-opened-view cache (read/write) | `src/settings.ts` | Add `get/setLastView` |
| Resolve the preference to a concrete `View` at mount | `src/App.tsx` | `useState<View>` lazy initializer |
| Record every view change into the cache | `src/App.tsx` | New `selectView` wraps the two `setView` call sites |
| Startup-page picker UI | `src/components/SettingsModal.tsx` | Add a `SelectField` under "Display" |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bump 0.14.0 -> 0.15.0 |

No backend (`src-tauri/`), `api.ts`, `config.ts`, `TodoPane`, `NotePane`, or
CSS change — the mobile single-pane CSS already keys off `data-view`, which
keeps working unchanged; this task only changes what value `view` starts at.

## `src/settings.ts` — two new pairs

```ts
import { DIRECTIONS, SORTS, STATUSES, VIEWS, type Direction, type Status, type View } from "./config";

const STARTUP_VIEW_KEY = "ntr.startupView";
const LAST_VIEW_KEY = "ntr.lastView";

// Which pane opens first. "last" resolves via getLastView() at the call site (App.tsx), not here —
// this getter only reports the user's *choice*, exactly as getConflictStrategy reports "ask"
// without resolving anything. Default "note" is the app's current hardcoded behaviour, represented
// by the absence of the key like every other preference in this file.
export type StartupView = View | "last";

export function getStartupView(): StartupView {
  const v = localStorage.getItem(STARTUP_VIEW_KEY);
  return v === "todo" || v === "last" ? v : "note";
}

export function setStartupView(v: StartupView): void {
  v === "note" ? localStorage.removeItem(STARTUP_VIEW_KEY) : localStorage.setItem(STARTUP_VIEW_KEY, v);
}

// The view the user last had open, updated on every switch regardless of the Startup page setting
// (App.tsx's selectView) so turning "Last opened" on later has an immediate, real value instead of
// a cold start. Unlike the preference pairs above, "note" here is not a default worth omitting —
// it is a real observation each time — so, unlike setStartupView, this always writes the key.
export function getLastView(): View {
  const v = localStorage.getItem(LAST_VIEW_KEY);
  return v && (VIEWS as readonly string[]).includes(v) ? (v as View) : "note";
}

export function setLastView(v: View): void {
  localStorage.setItem(LAST_VIEW_KEY, v);
}
```

`VIEWS`/`View` are imported the same way `STATUSES`/`Status` already are
(values + types from `config.ts`); `getLastView` validates against the table
(`VIEWS.includes`) rather than a literal `"todo"` check, for the same reason
task 24 validates `getSort`/`getStatus` against their tables — one source of
truth if a third view is ever added.

## `src/App.tsx` — seed from the preference, record every switch

1. **Import** the three new functions beside the existing `getCompactUi`
   import (`App.tsx:16`).

2. **Seed `view` from the preference**, resolving `"last"` at the point of
   use rather than inside `settings.ts` (keeps `getStartupView` a pure report
   of the stored choice, and keeps the "last" -> concrete-view resolution
   next to the only place it matters):

   ```ts
   const [view, setView] = useState<View>(() => {
     const startup = getStartupView();
     return startup === "last" ? getLastView() : startup;
   });
   ```

3. **Record every user-driven switch.** Both existing call sites currently
   call `setView` directly — the nav buttons (`App.tsx:153`) and the swipe
   handler (`App.tsx:122`). Both are replaced by one wrapper that persists
   alongside the state update, following task 24's "persist in the handler,
   not an effect" rule:

   ```ts
   // Change the active view and remember it, so a Startup page setting of "Last opened" can
   // restore it next launch. The only two callers that change view (nav click, swipe).
   function selectView(v: View) {
     setView(v);
     setLastView(v);
   }
   ```

   `onClick={() => setView(v)}` -> `onClick={() => selectView(v)}`; and
   `setView(VIEWS[next])` -> `selectView(VIEWS[next])` in `onTouchEnd`.

No other App.tsx behaviour changes: `onSettingsClose` does not need to re-read
the startup-page setting, because it only affects the view chosen at mount,
not the currently open one — changing the preference while the app is open
does not jump the user to a different pane (same "applies next launch, not
live" semantics `compactUi` explicitly avoided, but here it is correct
because "startup" means startup).

## `src/components/SettingsModal.tsx` — the picker

Add beside `STRATEGY_OPTIONS` (`SettingsModal.tsx:18-22`):

```ts
const STARTUP_VIEW_OPTIONS: FieldOption[] = [
  { value: "note", label: "Note" },
  { value: "todo", label: "Todo" },
  { value: "last", label: "Last opened" },
];
```

State, seeded in the existing `open` effect (`SettingsModal.tsx:40-55`)
alongside `setCompactState(getCompactUi())`:

```ts
const [startupView, setStartupViewState] = useState<StartupView>("note");
// ...in the open effect:
setStartupViewState(getStartupView());
```

Markup, appended to the existing "Display" section (`SettingsModal.tsx:162-176`),
right after the "Compact controls" checkbox/hint, using `SelectField` exactly
as "On conflict" does (`SettingsModal.tsx:183-195`):

```tsx
<label>
  Startup page
  <SelectField
    ariaLabel="Startup page"
    value={startupView}
    options={STARTUP_VIEW_OPTIONS}
    onChange={(v) => {
      const s = v as StartupView;
      setStartupViewState(s);
      setStartupView(s);
    }}
  />
</label>
<p className="settings-hint">
  Which pane opens first on mobile. Desktop always shows both.
</p>
```

No CSS change: `label > SelectField` and `.settings-hint` inside `#settings-form`
are already styled generically (the same rules the "On conflict" picker uses).

## Tests

1. **`src/settings.test.ts`** (extend, same file/pattern as task 24's
   additions) — two new `describe` blocks:
   - `getStartupView`/`setStartupView`: default `"note"` when absent;
     round-trips `"todo"` and `"last"`; an invalid stored value (e.g.
     `"bogus"`) falls back to `"note"`; setting back to `"note"` removes the
     key.
   - `getLastView`/`setLastView`: default `"note"` when absent; round-trips
     `"todo"`; an invalid stored value falls back to `"note"`; unlike the
     preference pair, setting `"note"` still writes the key (no removal) —
     assert `localStorage.getItem("ntr.lastView")` is `"note"` (not `null`)
     after `setLastView("note")`, pinning the "always writes" contract.

2. **`src/components/SettingsModal.test.tsx`** (extend, same pattern as the
   existing "Compact controls" / "On conflict" cases) — add a case: opening
   the "Startup page" picker and choosing "Last opened" calls through to
   persistence (`getStartupView()` is `"last"` after the pick), and the
   picker's seeded value on open reflects a pre-set `setStartupView("todo")`.

3. **No `src/App.tsx` test.** `App.tsx` has no existing test file (only
   `main.tsx` imports it — confirmed via `grep -rl "from \"\.\./App\""`
   across `src`); its SSE wiring, `onSettingsClose`, swipe gating, and
   `connectionKey` re-subscription are all likewise untested today. Adding
   the first `App.test.tsx` just for `selectView`/the lazy initializer would
   be a disproportionate lift (mocking `api.ts`'s Tauri/HTTP transport,
   `reconcileWithServer`, the `onChange` subscription) for logic that is
   otherwise fully exercised through `settings.ts`'s own tests. This mirrors
   the existing precedent rather than introducing a new one.

4. **No `TodoPane`/`NotePane`/`FilterBar` test change** — none of them read
   `view` or the new settings.

## Verification

- `npm test` — existing suites stay green; the new `settings` and
  `SettingsModal` cases pass.
- `npm run build` (tsc + vite) — type-checks `StartupView`, the new
  `settings.ts` exports, and the `App.tsx`/`SettingsModal.tsx` wiring;
  bundles at ntr@0.15.0.
- Manual, narrow viewport (<= 720px, where `view` is visible): default
  (Startup page = Note) opens on the Note pane on reload. Set Startup page =
  Todo, reload: opens on Todo. Set Startup page = Last opened, switch to Todo
  via the nav or a swipe, reload: opens on Todo (the last one shown); switch
  back to Note, reload: opens on Note.
- Manual, wide viewport (desktop, both panes visible): changing Startup page
  has no visible effect (both panes always show) — confirms the setting is
  inert there, as intended.
- The choice and the last-view cache both survive a reload (`localStorage`,
  keys `ntr.startupView` / `ntr.lastView`), and are never sent to the server
  (no `api.ts` change).

## Out of scope

- **No live view-jump when the setting changes.** Changing Startup page while
  the app is open does not switch the current pane; it only affects the next
  launch (see App.tsx section above).
- **No desktop-specific behaviour.** The setting is defined once and simply
  has no visible effect above the 720px breakpoint, by construction (no
  `onMobile()` branching added).
- **No new `App.test.tsx`** (rationale above) — coverage stays at the
  `settings.ts` (logic) and `SettingsModal.tsx` (UI-to-persistence) layers,
  matching how the rest of `App.tsx`'s orchestration is already tested (i.e.
  not directly).
- **No change to `VIEWS`/`View`** in `config.ts` — still exactly `["note",
  "todo"]`; `"last"` is a `StartupView`-only sentinel, never a `View` value
  (nothing renders `data-view="last"`).
