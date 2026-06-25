# 15 - Remove the focus border

## Goal

Remove the visible focus outline/border that the app draws when an element is
focused. Today two things put a border around a focused element:

1. An **explicit** accent outline on the note editor:
   `.note-input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }`
   (`src/style.css:125-128`).
2. The **browser-default** focus ring the user agent paints on every focusable
   control: the modal-picker trigger buttons (`.select-field`), the picker option
   and Remove buttons (`.picker-choice` / `.picker-remove`), the task action
   buttons, the settings button, dialog buttons, text/date inputs, and the
   `.note-input` contenteditable itself.

The user does not want a focused border anywhere. After this change no focused
element shows an outline ring.

## Approach — one rule, one deleted rule

This is a styling-only change. It lives entirely in `src/style.css`; no component,
config, or test file changes behaviour.

1. **Delete** the `.note-input:focus` block (`src/style.css:125-128`). It only
   exists to *add* a focus ring, which is exactly what we are removing. Leaving it
   would contradict the new global rule and be dead intent.

2. **Add** a single global rule that suppresses the user-agent focus outline on
   interactive elements:

   ```css
   /* No focus ring anywhere: the caret (note editor) and the aria-current
      highlight (picker rows) already show state, and the app is mouse-first. */
   :focus,
   :focus-visible {
     outline: none;
   }
   ```

   An author-origin `:focus { outline: none }` already overrides the user-agent
   `:focus-visible` ring by cascade *origin* (author beats UA) in both the Chromium
   and WebKit webviews Tauri uses, so `:focus` alone suffices; `:focus-visible` is
   listed as a defensive belt-and-suspenders selector, not a load-bearing one.
   `outline: none` (not `0`) reads as intent.

Place the global rule near the top of the file, right after the `* { box-sizing }`
reset (around `src/style.css:14-16`), so it reads as a base reset rather than
being buried among component rules. The deletion at lines 125-128 is independent.

## Why outline, not border

The focus indicator in this app is an `outline` (and the UA ring), never a CSS
`border` — element borders (`1px solid var(--border)` on inputs, triggers,
dialogs) are part of the resting look and must stay. The task's wording "border
outline" refers to the focus *ring*; we remove only `outline`, leaving every
resting `border` untouched. No `border` declaration is changed.

## Accessibility note (deliberate, scoped)

Removing focus rings reduces keyboard-navigation visibility. This is an explicit
product decision for this mouse-first desktop app, and state is still conveyed:
the contenteditable note shows a caret when focused, and picker rows show the
selected option via the existing `[aria-current="true"]` accent highlight
(`.picker-choice[aria-current="true"]`, unchanged). The change is one CSS rule, so
it is trivially reversible if keyboard focus visibility is wanted later.

## Where each concern lives

| Concern | Home | Change |
|---|---|---|
| Note-editor accent focus ring | `src/style.css:125-128` | Delete the `.note-input:focus` block |
| All other focus rings (buttons, inputs, dialogs, triggers, picker rows) | `src/style.css` | Add one global `:focus, :focus-visible { outline: none }` rule |
| Resting borders on inputs/triggers/dialogs | `src/style.css` | Unchanged |
| Selected-row highlight | `.picker-choice[aria-current="true"]` | Unchanged |
| Version | `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `Cargo.lock` | Bumped 0.4.0 -> 0.4.1 (done) |

## Tests

No test changes. The suites assert behaviour (DOM structure, store glue,
interactions), not computed styles, and `src/style.css` is not imported by any
test. `npm test` must still pass unchanged as a regression check that nothing
behavioural moved.

## Verification

- `npm test` — all existing suites pass (no behavioural change).
- `npm run build` (tsc + vite) — CSS still compiles; the bundle builds.
- Manual, local mode: click/tab through the note editor, the add form fields and
  date input, every modal picker trigger, the picker option and Remove buttons,
  the task Edit/Delete buttons, the settings button, and the dialog buttons — none
  shows a focus outline ring. Resting borders on inputs, triggers, and dialogs are
  unchanged, and the selected picker row still shows its accent highlight.

## Out of scope

- **No border changes.** Resting `1px solid var(--border)` borders stay.
- **No component / config / test changes.** Styling only.
- **No new dependency** and **no backend change** (`src-tauri/` untouched apart
  from the version bump).
- **No re-introduction of a custom focus style.** The goal is no focus ring, not a
  restyled one.
