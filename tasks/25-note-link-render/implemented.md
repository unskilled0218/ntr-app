# 25 - Implemented

Implements `plan.md` (brooks-review 99/100, see `plan-review.md`). The note editor now renders Markdown
links as just their link text styled as a hyperlink, reveals the raw `[text](url)` on the caret's line for
editing, and opens links via Ctrl/Cmd-click (desktop) or a long-press confirm modal (mobile) — all without
touching THE LINE INVARIANT.

## Files changed

- **`src/markdown.ts`** — added `linkMark` (a `.md-mark .md-link-mark` span) and rewrote the single link
  branch in `formatInline`: the text becomes `<a class="md-link" data-href="URL">text</a>`, with the `[`,
  `](`, `)` markers as `linkMark` spans and the URL kept in `<span class="md-url">`. Every character is still
  emitted (markers/URL hidden by CSS, not removed), so the round-trip invariant is unchanged. No `href` (only
  `data-href`) so contenteditable does not hijack the click and the URL is not normalised.

- **`src/style.css`** — `.md-link` now reads as a hyperlink (accent, underline, pointer). `.md-link-mark` and
  `.md-url` are `display: none` by default; a line tagged `.md-edit` reveals them inline so it is editable.

- **`src/lib/editLine.ts`** (new) — pure `setEditLine(root, caretNode)`: tags exactly the line containing the
  caret node with `.md-edit` and clears it from all others (or from all when the node is null). Only place the
  class is set; the inverse of the CSS rule. Toggling a class never moves the caret or fires selectionchange.

- **`src/lib/openLink.ts`** (new) — `openLink(url)` opens via `@tauri-apps/plugin-opener` `openUrl`, restricted
  to `http(s)`/`mailto` (a crafted note cannot reach the system handler with `file:`/`javascript:`/…), and
  swallows failures so it never throws into the editor.

- **`src/config.ts`** — added `LONG_PRESS_MS = 500` (touch hold before the open modal).

- **`src/components/useLinkGestures.ts`** (new hook) — open gestures kept off the plain click: Ctrl/Cmd-click
  opens immediately; a touch held `LONG_PRESS_MS` (without move/lift) sets `pending` (the URL) for the modal.
  Identifies a link purely by `.md-link` / `data-href` under the pointer, so it needs no editor ref. Returns
  `{ handlers, pending, confirm, dismiss }`. `onContextMenu` suppresses the native menu on links.

- **`src/components/OpenLinkDialog.tsx`** (new) — "Open link?" confirm modal, mirroring `RemoveLabelDialog`
  (native `<dialog>`, `useBackdropClose`, `.modal-actions`/`.primary`); `url={null}` = closed.

- **`src/components/NotePane.tsx`** — added a single `paint(text, caret)` write wrapper (`setEditorText` then
  `markEditLine`) and routed `adoptNote` / `rerenderNote` / `spliceNote` through it, so "re-tag the caret line
  after a render" has one home. Added a `selectionchange` listener (focus-guarded first, so it does no work
  unless the note is focused) to catch caret moves from clicks/arrows; `onBlur` now also clears `.md-edit`.
  Spread `links.handlers` on the editor and rendered `<OpenLinkDialog>`.

## Tests

- `src/markdown.test.ts` — kept the link round-trip (invariant guard); added the new `<a>`/`data-href`/marker
  markup assertions and a hostile-URL attribute-escaping case.
- `src/lib/editLine.test.ts` (new) — tags only the caret's line; moves with the caret; clears on null; ignores
  a node outside the root.
- `src/lib/openLink.test.ts` (new) — opens http/https/mailto; ignores other schemes; swallows rejections.
- `src/components/useLinkGestures.test.tsx` (new) — Ctrl/Cmd-click opens, plain click does not; touch
  long-press raises `pending`; move/lift before the threshold aborts; non-touch pointerdown is ignored.
- `src/components/NotePane.test.tsx` — added a reveal test: only the caret's line gains `.md-edit`, it moves
  with the caret, and blur collapses everything.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 184 passed (24 files), including the unchanged markdown round-trip and caret inverse
  tests that prove THE LINE INVARIANT survives.
- `npm run build` — tsc + vite succeed, bundled at ntr@0.14.0.
