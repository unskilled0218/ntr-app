# 21 - Hide the "note" / "todo" pane titles in mobile view

## Goal

On a narrow screen the app already shows one pane at a time, and the bottom nav's
two buttons ("Note" / "Todo") name the visible pane. The pane's own `<h1>` title
("note" in `NotePane`, "todo" in `TodoPane`) is therefore redundant on mobile: it
repeats the bottom-nav label and spends a row of vertical space that the small
viewport can ill afford. Hide both pane titles when — and only when — the app is in
single-pane (mobile) layout. On desktop, where both panes show side by side and the
bottom nav is hidden, the titles are the only labels and must stay.

## The single idea — and where it already lives

"Are we in single-pane (mobile) layout?" is one decision, and this codebase has
already chosen exactly one home for it: the `@media (max-width: 720px)` block in
`src/style.css`. The lead comment on `.bottom-nav` (style.css:88-90) is explicit
that the breakpoint is owned by CSS and that JS deliberately *reads the bottom
nav's computed `display`* rather than re-encoding the 720px threshold anywhere
else. Hiding the titles is the same kind of decision — "this is mobile, so present
differently" — so it belongs in that same block, not in a second place.

That settles the approach: **one CSS rule inside the existing media query**, no JS,
no markup change. Anything else would re-spell the breakpoint that style.css:88-90
warns against duplicating.

### Why not a `window.matchMedia` check in React

A `matchMedia("(max-width: 720px)")` hook that conditionally drops the `<h1>` would
work, but it re-encodes the 720px breakpoint a second time (the exact duplication
the bottom-nav comment calls out), adds a stateful hook + resize listener to two
components, and gains nothing: the title carries no behaviour, only presentation.
Presentation that switches on viewport width is precisely what a media query is
for. CSS keeps the breakpoint singular.

### Why not delete the `<h1>` markup

The titles are required on desktop — they are the only pane labels there. So the
elements must stay in the DOM; only their visibility is viewport-dependent. That is
a CSS concern, not a markup one.

## The selector — exactly the two titles, nothing else

Inside the `@media (max-width: 720px)` block, add:

```css
/* The pane titles ("note" / "todo") duplicate the bottom-nav labels in single-pane
   mode, so reclaim their row; the bottom nav names the visible pane. */
.note-pane h1,
.todo-pane h1 {
  display: none;
}
```

The selector names the two panes whose titles it hides rather than matching "any
`<h1>` under a `.pane`", so a future legitimate `<h1>` added elsewhere is not
silently hidden (plan-review.md round-1 suggestion). It must be a **descendant**
(space) combinator, not a child (`>`) one: `NotePane`'s `<h1>note</h1>` is a direct
child of `.note-pane` (NotePane.tsx:181), but `TodoPane`'s `<h1>todo</h1>` is nested
inside `.todo-header` (TodoPane.tsx:177-178), so `>` would miss the todo title.

It matches **only** the two pane titles. The note editor renders Markdown headings
as `<div class="md-line md-h1">` (built by the caret/markdown helpers in
`src/lib/caret.ts` — see `.md-h1` styling at style.css:196-207), never as real
`<h1>` elements, so a Markdown `# heading` typed into the note is untouched. The
sole real `<h1>` elements in the whole app are those two titles; the selector is
exact and no extra guard class is needed.

## Layout consequences (verified against the existing rules) — none adverse

- **`display: none` (not `visibility: hidden`)** so the row is reclaimed, not left
  blank. The pane is `display: flex; flex-direction: column` (style.css:80-86); with
  the `<h1>` removed from layout, the remaining children (note editor / todo header)
  simply take the freed height. `.note-input`'s comment "take the height left under
  the h1 and the status bar" (style.css:148) stays literally true — there is just no
  h1 to sit under, so it gains that height. No change to `.note-input` needed.
- **Compact todo header.** In compact mode `.todo-header--compact` is
  `display: flex; justify-content: space-between` with the `<h1>` and the `FilterBar`
  as its two children (style.css:361-364). Hiding the `<h1>` leaves the `FilterBar`
  as the sole flex child; `justify-content: space-between` with one item leaves it at
  the start (left-aligned), which is the correct, unbroken result. Non-compact
  `.todo-header` is a plain block, so removing the `<h1>` just drops the title row.
- **Accessibility.** `display: none` drops the title from the a11y tree on mobile,
  but the pane is still named: the bottom-nav buttons carry the "Note"/"Todo" labels
  and each `aria-controls` its pane (`note-view` / `todo-view`, App.tsx:144-153). No
  label is lost.

## Per-file edits

- **`src/style.css`** — add the `.note-pane h1, .todo-pane h1 { display: none; }`
  rule (with the comment above) **inside** the existing `@media (max-width: 720px)`
  block, alongside the sibling `.pane` / `main[data-view=...]` single-pane rules
  (style.css:103-109). One block, one home for the mobile layout decision.
- **Version** — already bumped 0.9.0 -> 0.10.0 (package.json, tauri.conf.json,
  Cargo.toml, Cargo.lock) at the start of this task.

No change to `NotePane.tsx`, `TodoPane.tsx`, `App.tsx`, any `src-tauri/` file, or any
component logic.

## Tests

No unit test is added, deliberately and consistently with the existing suite. The
change is pure media-query presentation, and the test environment (jsdom, via
`src/test/setup.ts`) does not perform layout or evaluate `@media` rules, so a
"hidden on mobile" assertion through `getComputedStyle` would not reflect the media
query and would assert nothing real. This mirrors the rest of the single-pane CSS
(the `.pane { display: none }` / `main[data-view]` rules), which likewise carry no
jsdom test for the same reason. The existing `NotePane.test.tsx` /
`TodoPane.test.tsx` suites stay green: they query the panes by content/role, never
by a title-visibility computed style, and the markup is unchanged.

## Verification

- `npm run build` (tsc + vite) — no TypeScript change, but confirms the stylesheet
  still bundles cleanly under the bumped version (ntr@0.10.0).
- `npm test` — the full suite stays green (no markup/logic change).
- Manual: narrow the window below 720px (or use a device) — the "note" and "todo"
  titles disappear and the note editor / task list take the reclaimed row, in both
  normal and compact-controls mode; the bottom nav still names the visible pane.
  Widen past 720px — both titles reappear above their panes.

## Out of scope

- **No `matchMedia`/JS breakpoint** — would duplicate the 720px threshold the
  bottom-nav comment (style.css:88-90) designates as CSS-owned.
- **No markup removal** — the titles are the only pane labels on desktop and must
  remain in the DOM.
- **No change to the bottom nav, swipe, or `data-view` mechanism** — the existing
  single-pane machinery already decides which pane is visible; this task only hides
  a redundant title within it.
- **No restyle of the freed space** (no compensating padding/margin) — the flex
  column reclaims the height correctly on its own; adding spacing would be invented
  work.
