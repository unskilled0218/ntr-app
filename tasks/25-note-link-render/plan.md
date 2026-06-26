# 25 - Render note Markdown links as clickable text, revealed for editing on the caret's line

## Goal

In the note editor, a Markdown link `[text](url)` should read as **just its link text**, styled as a
hyperlink — the `[`, `](`, the URL, and `)` are hidden — **except** on the line the caret is on, where
the full raw `[text](url)` is shown so it stays editable. Opening a link is a deliberate gesture, never a
plain click:

- **Desktop**: plain click edits (places the caret); **Ctrl/Cmd + click** opens the link in the system browser.
- **Mobile**: plain tap edits; **long-press** opens an "Open link?" confirmation modal, and confirming opens it.

Today the note editor (`src/components/NotePane.tsx`, a single `contenteditable`) already highlights links
via `formatInline` in `src/markdown.ts:50-61`, but it shows the **whole** `[text](url)` with the syntax
markers merely dimmed (`.md-mark`), and the link text is an inert `<span class="md-link">`. There is no way
to open a link and no caret-aware reveal. This task delivers both.

## The hard constraint that shapes the whole design: THE LINE INVARIANT must survive

The note editor's defining rule (`src/lib/caret.ts:1-13`, `src/markdown.ts:1-5`) is that the editor IS the
preview: `readNoteText` joins each line `<div>`'s `textContent` with `"\n"` and **must** equal the raw
Markdown, and `getCaret`/`setCaret` count `textContent.length` per line. `highlightMarkdown` only ever
*wraps* characters in spans; it never adds, removes, or reorders one. The `markdown.test.ts` round-trip
suite locks this in.

Therefore **"hide the URL" cannot mean "remove it from the DOM."** Every character of `[text](url)` stays
in the DOM as text; the brackets and URL are only **visually hidden with CSS** (`display: none`). This is
the single decision that makes the feature safe:

- `textContent` includes the text of `display: none` elements, so `readNoteText` is unchanged.
- `Range.toString()` (used by `getCaret`) concatenates text-node data regardless of rendering, so caret
  offsets are unchanged.
- The `TreeWalker(SHOW_TEXT)` in `setCaret`/`placeInLine` visits hidden text nodes, so the caret can be
  placed at any logical offset.

**Result: `caret.ts` does not change at all, and the round-trip invariant test keeps passing verbatim.**

## The single idea: collapse is the default rendering; the caret's line is the one exception, toggled by a class — never by re-rendering

The collapsed form and the expanded (raw) form are the **same markup**; they differ only by whether the
link markers and URL are visibly displayed. So there is no need for the renderer to know where the caret is,
and no need to re-render HTML when the caret moves. The reveal is a **single CSS class, `md-edit`, toggled
on exactly one line `<div>`**:

- `src/markdown.ts` renders **every** link in one collapsed-by-default form (markers/URL present but hidden
  by CSS). It stays a pure `(src) => html` function — no caret parameter.
- `src/components/NotePane.tsx` keeps `md-edit` on whichever line currently holds the caret. Toggling a
  class never moves the caret or fires `selectionchange`, so this is re-entrancy-free and cannot disturb a
  selection (unlike re-rendering `innerHTML`, which would).

This keeps the two delicate, invariant-bearing modules (`markdown.ts`, `caret.ts`) almost untouched and puts
the only stateful behaviour where state already lives (`NotePane`).

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| Collapsed link markup (`<a>` + hidden markers/URL) | `src/markdown.ts` | Rewrite the one link branch in `formatInline`; add a `linkMark` helper |
| Hide markers/URL by default; reveal under `.md-edit`; link look | `src/style.css` | New rules for `.md-link-mark` / `.md-url` / `.md-link` / `.md-edit` |
| "Which line has the caret" → toggle `md-edit` | `src/lib/editLine.ts` (new) | Pure `setEditLine(root, caretNode)` |
| Read the selection, drive `setEditLine`, re-apply after every render | `src/components/NotePane.tsx` | `markEditLine()` + a `paint` write-wrapper + a `selectionchange` listener + blur-clear |
| Open gestures (Ctrl/Cmd-click; touch long-press) + pending-link state | `src/components/useLinkGestures.ts` (new hook) | Returns editor event handlers + the pending URL |
| "Open link?" confirmation modal | `src/components/OpenLinkDialog.tsx` (new) | Mirrors `RemoveLabelDialog` |
| Open a URL in the system browser (Tauri) | `src/lib/openLink.ts` (new) | Wraps `@tauri-apps/plugin-opener` `openUrl`, scheme-guarded |
| Long-press threshold | `src/config.ts` | Add `LONG_PRESS_MS = 500` |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.13.0 -> 0.14.0 (done) |

No change to `src/lib/caret.ts`, `src/api.ts`, the backend (`src-tauri/`), or any other pane.

## `src/markdown.ts` — one collapsed link form

`formatInline` runs on an **already-escaped** run, so `t` (text) and `u` (URL) are HTML-safe for both
element text and a double-quoted attribute (`escapeHtml` escapes `& < > " '`). Replace the current link
branch (`markdown.ts:52-56`) with a single form that is identical whether or not it is being edited:

```ts
// A dimmed, kept LINK marker ([ , ]( , )); like mark() but additionally tagged so the CSS can hide just
// link syntax (never heading #, bold **, etc.) when the line is not being edited.
const linkMark = (s: string) => `<span class="md-mark md-link-mark">${s}</span>`;

// inside formatInline(), replacing the existing .replace(/\[...\]\(...\)/) branch:
.replace(
  /\[([^\]]+)\]\(([^)]+)\)/g,
  (_, t, u) =>
    `${linkMark("[")}<a class="md-link" data-href="${u}">${t}</a>${linkMark("](")}<span class="md-url">${u}</span>${linkMark(")")}`,
)
```

Notes:

- **`<a>` carries no `href`, only `data-href`.** A real `href` inside a `contenteditable` invites the
  browser's own click-to-navigate / drag behaviour and URL normalisation; we open via Tauri instead and
  identify links by the `.md-link` class. `data-href` holds the escaped URL, and `el.dataset.href` reads it
  back **decoded** to the raw URL (e.g. `&amp;` -> `&`), so no double-escaping.
- **The text is an `<a>` in both states** — collapse vs. reveal is purely the line's `md-edit` class, so the
  markup has one home (conceptual integrity) and Ctrl/Cmd-click works whether or not the line is being edited.
- **Every character is still emitted** (`[`, `](`, `u`, `)`), so the round-trip invariant holds; the markers
  and URL are merely `display: none` until the line is edited.

## `src/style.css` — hide link syntax by default, reveal it on the edited line

Replace the existing `.md-link, .md-url { color: var(--accent); }` block (`style.css:262-265`) with:

```css
/* A Markdown link reads as just its text (a hyperlink); the brackets and URL are hidden until the caret
   is on that line, when the line gains .md-edit and the raw [text](url) is revealed for editing. The
   characters are always present in the DOM (THE LINE INVARIANT) — only their visibility changes. */
.md-link {
  color: var(--accent);
  text-decoration: underline;
  cursor: pointer;
}
.md-link-mark,
.md-url {
  display: none; /* link syntax is hidden in the collapsed (default) state */
}
.md-line.md-edit .md-link-mark,
.md-line.md-edit .md-url {
  display: inline; /* the caret's line shows the raw Markdown so it can be edited */
  color: var(--accent);
}
```

`.md-link-mark` also carries `.md-mark`, so when revealed it is dimmed (`opacity: 0.45`) exactly like every
other kept marker — no new dimming rule.

## `src/lib/editLine.ts` (new) — the pure "tag the caret's line" function

```ts
// Reveal the raw Markdown of the line the caret is on by tagging exactly that line `.md-edit`; every other
// line stays collapsed (its links show as just their text). Pure DOM, no selection reading: given the node
// the caret sits in (or null when the editor is unfocused), find its line — a direct child of root — and
// give only that line the class. Toggling a class never moves the caret or fires selectionchange, so this
// is safe to call as often as the selection changes and cannot recurse.
export function setEditLine(root: HTMLElement, caretNode: Node | null): void {
  let line: Node | null = caretNode && root.contains(caretNode) ? caretNode : null;
  while (line && line.parentNode !== root) line = line.parentNode;
  for (const child of Array.from(root.children)) child.classList.toggle("md-edit", child === line);
}
```

It lives in `src/lib/` beside `caret.ts` (both are editor line-geometry helpers) but, unlike `caret.ts`,
introduces no dependency on `markdown.ts` — it only knows the `md-edit` class name, the inverse of the CSS
rule above.

## `src/components/useLinkGestures.ts` (new) — open-gesture detection as a hook

NotePane is already large and carries the contenteditable-invariant burden; the open gestures are
self-contained (they work off the event target, needing no editor ref or caret math), so they extract
cleanly into a hook beside `useBackdropClose` / `usePickerDialog`.

```ts
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import { LONG_PRESS_MS } from "../config";
import { openLink } from "../lib/openLink";

const linkAt = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? (target.closest("a.md-link") as HTMLElement | null) : null;

// Open-link gestures for the note editor, kept off the plain click so a tap always edits:
//   desktop  -> Ctrl/Cmd + click opens immediately;
//   touch    -> a press held LONG_PRESS_MS (without moving) raises the confirm modal, whose URL is
//               returned as `pending`; a move/lift/cancel before then aborts.
// Gestures identify a link purely by the .md-link element under the pointer (data-href = the raw URL),
// so the hook needs no editor ref and stays decoupled from the caret/render path.
export function useLinkGestures() {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onClick = (e: ReactMouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain click edits; only the modifier opens
    const a = linkAt(e.target);
    if (!a?.dataset.href) return;
    e.preventDefault();
    openLink(a.dataset.href);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return; // long-press is the touch gesture only
    const a = linkAt(e.target);
    if (!a?.dataset.href) return;
    const url = a.dataset.href;
    cancel();
    timer.current = setTimeout(() => setPending(url), LONG_PRESS_MS);
  };

  // A long-press that turns into a scroll/selection, or is lifted early, must not open.
  const onContextMenu = (e: ReactMouseEvent) => {
    if (linkAt(e.target)) e.preventDefault(); // suppress the native menu; our modal replaces it
  };

  return {
    handlers: { onClick, onPointerDown, onPointerMove: cancel, onPointerUp: cancel, onPointerCancel: cancel, onContextMenu },
    pending,
    confirm: () => {
      if (pending) openLink(pending);
      setPending(null);
    },
    dismiss: () => setPending(null),
  };
}
```

## `src/lib/openLink.ts` (new) — open a URL in the system browser, scheme-guarded

```ts
import { openUrl } from "@tauri-apps/plugin-opener";

// Open a note link in the OS browser via the Tauri opener plugin (already a dependency and capability —
// see src-tauri/capabilities/default.json "opener:default"). Restricted to http(s)/mailto so a crafted
// note can never hand the system handler an arbitrary scheme; anything else is ignored. Failures (e.g. no
// Tauri runtime under tests) are swallowed: opening a link must never throw into the editor.
export function openLink(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  openUrl(url).catch(() => {});
}
```

## `src/config.ts` — the long-press threshold

Add beside the existing timing constants (e.g. `NOTE_SAVE_DELAY_MS`):

```ts
export const LONG_PRESS_MS = 500; // touch hold time that raises the "Open link?" modal
```

## `src/components/OpenLinkDialog.tsx` (new) — the mobile confirm modal

Mirrors `RemoveLabelDialog` exactly (native `<dialog>`, `useBackdropClose`, `.modal-actions` / `.primary`),
so no new dialog idiom or CSS:

```tsx
import { useEffect, useRef } from "react";
import { useBackdropClose } from "./useBackdropClose";

interface Props {
  url: string | null; // null = closed
  onConfirm(): void;
  onCancel(): void; // Cancel button and the native close event (Escape / backdrop)
}

export default function OpenLinkDialog({ url, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = url !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useBackdropClose(dialogRef);

  return (
    <dialog id="open-link-dialog" ref={dialogRef} aria-label="Open link" onClose={onCancel}>
      <h2>Open link?</h2>
      <p className="note-conflict-msg">
        Open <strong>{url}</strong> in your browser.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          Open
        </button>
      </div>
    </dialog>
  );
}
```

## `src/components/NotePane.tsx` — keep `md-edit` on the caret's line, wire the gestures and the modal

Four surgical additions; no change to the autosave/conflict logic.

1. **Imports**: `import { setEditLine } from "../lib/editLine";`, `import { useLinkGestures } from "./useLinkGestures";`,
   `import OpenLinkDialog from "./OpenLinkDialog";`.

2. **`markEditLine`, called from one render wrapper.** `markEditLine` reads the selection and delegates the
   DOM work to the pure `setEditLine`. Re-rendering `innerHTML` drops the class and detaches the old line
   node, so the tag must be re-applied after **every** render. Rather than remember that at each of the three
   render call sites (a shotgun-surgery trap — a future fourth render path would silently forget it), route
   them through one local write wrapper, `paint`, so "re-tag the caret's line after rendering" has a single
   home:

   ```ts
   // The component's single editor-write path: render text + restore caret (the shared setEditorText),
   // then re-tag the caret's line so its links reveal. Every render path goes through here, so the reveal
   // cannot drift out of sync with a render.
   const paint = (text: string, caret: number | null) => {
     setEditorText(editor(), text, caret);
     markEditLine();
   };

   // Reveal the raw Markdown on whichever line the caret is on (collapse every other line's links).
   const markEditLine = () => {
     const sel = window.getSelection();
     const focused = document.activeElement === editor() && sel && sel.rangeCount > 0;
     setEditLine(editor(), focused ? sel!.getRangeAt(0).startContainer : null);
   };
   ```

   The three existing render paths switch from calling `setEditorText` directly to calling `paint`:
   `rerenderNote` becomes `paint(readNoteText(editor()), getCaret(editor()))`; `adoptNote` calls
   `paint(text, null)`; `spliceNote` calls `paint(text.slice(0, at) + insert + text.slice(at), at + insert.length)`.
   On load the editor is unfocused, so `paint(..., null)` -> `markEditLine` collapses every link and the note
   opens as clean rendered text.

3. **A `selectionchange` listener** (added once on mount, beside the existing `pagehide` effect). It is the
   only way to catch caret moves from plain clicks and arrow keys, which do not fire `onInput`. It guards on
   focus **first**, so a selection change anywhere else in the app (the add-task field, a modal) returns
   immediately instead of walking the note's lines:

   ```ts
   useEffect(() => {
     const onSelect = () => {
       if (composingNote.current || document.activeElement !== editor()) return;
       markEditLine();
     };
     document.addEventListener("selectionchange", onSelect);
     return () => document.removeEventListener("selectionchange", onSelect);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
   ```

   Because it only toggles a class (never touches the selection), it cannot re-enter via `selectionchange`.
   Collapsing on blur is handled explicitly (next point) rather than through this listener, so the listener
   never does work while the editor is unfocused.

   **On blur, collapse every link**: extend the existing `onBlur` to clear the tag —
   `onBlur={() => { void flushNote(); setEditLine(editor(), null); }}` — so leaving the note shows it fully
   rendered. (`blur` does not reliably emit `selectionchange`, so this is explicit, and it is the one place
   that clears the tag when focus leaves.)

4. **Spread the gesture handlers on the editor and render the modal**:

   ```tsx
   const links = useLinkGestures();
   // ... on the contenteditable <div>, alongside the existing handlers:
   {...links.handlers}
   // ... after <NoteConflictDialog ... />:
   <OpenLinkDialog url={links.pending} onConfirm={links.confirm} onCancel={links.dismiss} />
   ```

   The gesture `onClick`/`onPointer*` handlers are additive — a plain click still falls through to the
   browser's default caret placement, which then fires `selectionchange` and expands that line.

### Why a class toggle, not a re-render, for the reveal

Re-rendering `innerHTML` to swap a link between collapsed and expanded would (a) have to restore the caret,
(b) fire `selectionchange` from `setCaret`, risking a loop, and (c) **collapse any active mouse selection**
that crosses the line. A class toggle does none of these. Since collapsed and expanded markup are identical
except for visibility, the class is sufficient and strictly safer — this is why `markdown.ts` need not know
the caret position.

### Why a hook for gestures but inline code for `markEditLine`

The gestures are pure target-driven event handlers with their own small piece of state (the pending URL) and
no dependency on the editor's internals — a textbook deep, reusable hook. `markEditLine` instead reads the
editor ref and the live selection and must run on the same render paths as the existing caret restore, so it
belongs in `NotePane` beside `rerenderNote`; extracting it would only thread the ref back out for no gain.

## Tests

1. **`src/markdown.test.ts`** (extend):
   - The existing `roundTrips("a [link](https://example.com) inline")` case **still passes unchanged** —
     proof the invariant survives. Keep it; it is the primary guard.
   - **Add** a `describe("links")` asserting the new markup on `highlightMarkdown("see [docs](https://x.io/a?b=1&c=2)")`:
     contains `<a class="md-link" data-href="https://x.io/a?b=1&amp;c=2">docs</a>`; contains
     `class="md-mark md-link-mark"` for the `[`, `](`, `)` markers; contains `<span class="md-url">` holding
     the (escaped) URL; and that reading it back (`readNoteText`) equals the source (markers/URL not removed).
   - **Add** an injection case: `highlightMarkdown('[x](http://e/"><img src=y onerror=z>')` produces no raw
     `"` or `<` inside the `data-href` attribute value (everything escaped), guarding the attribute sink.

2. **`src/lib/editLine.test.ts`** (new): build a root with three line `<div>`s (a text node in each),
   and assert:
   - `setEditLine(root, node2)` puts `md-edit` on **only** line 2.
   - calling it again with `node3` moves the class to line 3 (line 2 cleared).
   - `setEditLine(root, null)` clears the class from every line.
   - a node **outside** root leaves no line marked.

3. **`src/lib/openLink.test.ts`** (new): mock `@tauri-apps/plugin-opener` (`vi.mock`), assert
   `openLink("https://x.io")` and `openLink("mailto:a@b")` call `openUrl` once with that URL, and
   `openLink("javascript:alert(1)")` / `openLink("file:///etc/passwd")` do **not** call it (scheme guard).

4. **`src/components/useLinkGestures.test.tsx`** (new): render a tiny probe component that spreads
   `handlers` onto a div containing `<a class="md-link" data-href="https://x.io">d</a>`, mock
   `../lib/openLink`, use fake timers, and assert:
   - Ctrl-click (and Cmd/meta-click) on the link calls `openLink` once; a **plain** click does not.
   - a `pointerdown` with `pointerType: "touch"` on the link, after advancing `LONG_PRESS_MS`, sets
     `pending` to the URL (assert via the rendered `OpenLinkDialog` text, or expose `pending`); a
     `pointermove`/`pointerup` before the timer aborts (no modal).
   - `confirm()` calls `openLink` with the pending URL and clears it; `dismiss()` clears without opening.

5. **`src/components/NotePane.test.tsx`** (extend; jsdom selection works — see `caret.test.ts`): after
   loading a note whose body has a link on its own line, focus the editor, place the caret (via
   `setCaret`/Selection) on the link's line and dispatch `selectionchange`, and assert that line's `<div>`
   gains `md-edit` while a link line **without** the caret does not. Reuse the file's existing
   render/`flushMicrotasks` scaffolding and the `<dialog>` polyfill already present.

6. **No `caret.test.ts` change** — `caret.ts` is untouched, and its round-trip test is exactly the invariant
   this design preserves.

## Verification

- `npm test` — existing suites stay green (notably the `markdown` round-trip and `caret` inverse tests,
  which prove the invariant is intact); the four new/extended suites pass.
- `npm run build` (tsc + vite) — type-checks the new modules and the `@tauri-apps/plugin-opener` import,
  bundles at ntr@0.14.0.
- Manual (desktop, Tauri): a note containing `See the [docs](https://example.com).` shows "See the docs."
  with "docs" underlined; clicking onto that line reveals `[docs](https://example.com)` for editing and
  collapses again when the caret leaves; **Ctrl/Cmd-click** on "docs" opens example.com in the system
  browser; a plain click just edits.
- Manual (mobile/touch): tapping "docs" edits; **long-pressing** it raises "Open link?", and Open launches
  the browser while Cancel/Escape/backdrop dismisses with no navigation.

## Out of scope

- **Other panes / task descriptions.** Tasks render as plain text (`TaskItem.tsx`) and are unaffected; this
  feature is the note editor only.
- **Reference-style `[text][id]` links, autolinks `<https://…>`, or images `![alt](src)`.** Only the inline
  `[text](url)` form already recognised by `formatInline` is handled; the regex is unchanged.
- **Keyboard-only open** (e.g. an Enter/shortcut on a focused link). Opening is pointer-driven per the
  spec (Ctrl/Cmd-click, long-press); a keyboard affordance is a separate accessibility task.
- **`caret.ts` and the line/caret math** — unchanged by design; the hidden-character approach is what lets
  them stay unchanged.
- **No backend, API, or persistence change** — rendering and gestures are entirely client-side.
