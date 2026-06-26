# 21 - Implemented

## What changed

One CSS rule, exactly as the plan specified, plus the version bump.

### `src/style.css` — hide the pane titles in single-pane (mobile) layout

Inside the existing `@media (max-width: 720px)` block, immediately after the
`main[data-view=...] .note-pane / .todo-pane { display: flex }` re-show rules:

```css
/* The pane titles ("note" / "todo") duplicate the bottom-nav labels in single-pane mode, so
   reclaim their row; the bottom nav names the visible pane. Descendant (not child) combinator:
   note's h1 is a direct child of .note-pane but todo's sits inside .todo-header. */
.note-pane h1,
.todo-pane h1 {
  display: none;
}
```

The rule lives in the one place this codebase keeps the mobile-layout decision (the
720px media query), so the breakpoint is not duplicated. The selector names the two
panes (not "any `.pane h1`") and uses a descendant combinator because `NotePane`'s
`<h1>` is a direct child of `.note-pane` while `TodoPane`'s `<h1>` is nested inside
`.todo-header`. On desktop (≥720px) the rule does not apply, so both titles show as
before.

### Version bump 0.9.0 -> 0.10.0

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock` (the `ntr` package entry)

## What did NOT change

No change to `NotePane.tsx`, `TodoPane.tsx`, `App.tsx`, any `src-tauri/` source, any
component logic, or any test. The titles remain in the DOM (required as the only pane
labels on desktop); only their mobile visibility changed. No new test added — the
change is pure media-query presentation that jsdom does not evaluate, consistent with
the rest of the single-pane CSS (see plan "Tests").

## Verification

- `npm run build` (tsc + vite) — clean, ntr@0.10.0; CSS bundles
  (`dist/assets/index-*.css`, 7.93 kB).
- `npm test` — 20 files, 150 tests, all pass (unchanged from before).
- Manual (to confirm on device/narrow window): below 720px the "note"/"todo" titles
  are gone and the editor / task list take the reclaimed row, in both normal and
  compact-controls mode; above 720px both titles reappear.
