# 27 - Space and Tab keys in the note

## Goal

In the note editor, Space must type a space and Tab must indent. Today neither works:

- Space inserts a new line when the caret's line has a line under it.
- Space does nothing (the character vanishes) when it does not.
- Tab does not indent at all; it moves focus out of the editor to the next focusable element.

## Why it happens

The note is a contenteditable that is driven imperatively (`src/components/NotePane.tsx:1-8`): its DOM is written only by `setEditorText`, and its logical text is defined by THE LINE INVARIANT in `src/lib/caret.ts:15-19` -- `readNoteText` reads **element children only** (`root.children`) and joins each line's `textContent` with exactly one `"\n"`. Every keystroke then goes `onInput` -> `rerenderNote` -> `paint(readNoteText, getCaret)`, so anything the browser's default editing put into the DOM that does not fit "one `.md-line` element per line, text inside it" is re-interpreted or lost on the very next repaint. Three separate defects meet on the Space/Tab keys:

1. **The browser owns the Space keystroke.** `Enter` and paste are the only inputs the component intercepts (`NotePane.tsx:231-240`); everything else falls through to the browser's native contenteditable editing, which is free to split a line, wrap the typed character in its own block, or drop a bare text node directly under the root. `readNoteText` skips bare text nodes (they are not in `root.children`) and treats any element the browser created as a **new line** -- which is exactly the pair of symptoms above: a stray new line, or a character that disappears.

2. **Whitespace-only lines lose their whitespace.** Even when the space does reach the right line, `blockKind` classifies `" "` as `blank` (`src/markdown.ts:28`) and the `blank` renderer emits `<div class="md-line"><br></div>` (`markdown.ts:111`) -- textContent `""`. So a line that is only spaces/tabs round-trips to an empty line and the typed whitespace is destroyed on the next repaint. This **violates THE LINE INVARIANT** (`highlightMarkdown` is supposed never to add, remove, or reorder a character), and it is the reason a space on an otherwise-empty line can never stick, no matter who inserts it.

3. **Tab is a focus key by default.** Nothing intercepts it, so the browser does what it does in any editable: move focus. That also triggers `onBlur` -> `flushNote`, which is why Tab feels like "leave the note".

## The single idea: the note owns every key that produces text

`Enter` already shows the shape of the fix (`NotePane.tsx:181-187`, `231-236`): `preventDefault()`, then splice the character into the **logical text** and repaint through the one write path. Space and Tab join it. The rule for the component becomes: *any key that inserts characters is spliced by us; the browser is only allowed to do the edits we have verified survive a repaint (typing a normal character, backspace, delete).* This keeps the DOM flat -- one `.md-line` div per line -- which is the assumption the whole caret/markdown pair rests on.

That is deliberately narrow: we are not switching to `beforeinput`, `execCommand`, or a rewrite of the input model. We fix the two keys the task names, plus the invariant violation (2) that would silently eat the typed whitespace even after the keys are intercepted.

## `spliceNote` must respect the selection

`spliceNote` inserts at `getCaret()`, which is the range's **start** and ignores the rest of a non-collapsed selection (`caret.ts:24-40`, `NotePane.tsx:181-187`). Today that is a latent bug for Enter and paste; for Space it becomes an everyday one -- selecting a word and pressing Space must *replace* the word, not insert a space before it. So `spliceNote` splices over a range `[start, end]` instead of at a point. This is required by the task, not a side quest: without it "space works" is false for the most common selection gesture.

`caret.ts` gains a `getCaretRange(root): { start: number; end: number } | null` alongside `getCaret`, sharing one offset-of-a-boundary-point helper so both stay exact inverses of the `readNoteText` join (the file's stated reason for keeping these together). `getCaret` becomes `getCaretRange(...)?.start ?? null`, so there is still exactly one home for "how many characters precede this DOM point".

## Changes

### `src/lib/caret.ts`

- Extract the body of `getCaret`'s loop into `offsetOf(root, container, offset): number` -- characters before one DOM boundary point, counting one `"\n"` per line boundary (unchanged logic, unchanged invariant comment).
- Add `getCaretRange(root)`: `null` when the selection is absent or outside the editor; otherwise `{ start: offsetOf(startContainer, startOffset), end: offsetOf(endContainer, endOffset) }`. A collapsed selection gives `start === end`, so callers need no special case.
- `getCaret(root)` keeps its signature and delegates to `getCaretRange`.

### `src/markdown.ts`

- `blank` renderer: keep `<br>` only for a genuinely empty line; a whitespace-only line emits its own escaped characters (`<div class="md-line">${escapeHtml(line)}</div>`). Every character is then preserved and THE LINE INVARIANT holds for whitespace-only lines. `blockKind` is untouched -- a whitespace-only line is still the `blank` *block* (it still separates paragraphs and does not become a paragraph); only its rendering stops destroying characters.

### `src/components/NotePane.tsx`

- `spliceNote(insert)` uses `getCaretRange`, splices `text.slice(0, start) + insert + text.slice(end)` and puts the caret at `start + insert.length`. Falls back to `text.length` (append) when there is no range, as today.
- `onKeyDown` handles, in one guarded block:
  - Bail out first when the event is composing (`e.nativeEvent.isComposing`) or `composingNote.current` is set -- an IME must keep owning its keystrokes -- and when Ctrl/Meta/Alt is held, so shortcuts still reach the browser.
  - `Enter` -> `preventDefault` + `spliceNote("\n")` (existing behaviour, now selection-aware and composition-guarded).
  - `" "` -> `preventDefault` + `spliceNote(" ")`.
  - `Tab` without Shift -> `preventDefault` + `spliceNote("\t")`.
  - **Shift+Tab is deliberately left alone**: it keeps moving focus, so a keyboard-only user still has a way out of the editor (an editable that traps Tab in both directions is a keyboard trap). Nothing else in the app needs forward-Tab from the note.
- Indentation character: a real `"\t"`. The note is stored and served as raw Markdown, and a tab is what the key means; `LIST_ITEM`'s `^(\s*)` already accepts it, so a tab-indented bullet still highlights as a list item.

### `src/style.css`

- `tab-size: 2` on `.note-input` (AGENTS.md: tab size = 2), so a `"\t"` renders as a two-column indent under the existing `white-space: pre-wrap`.

## Tests

- `src/markdown.test.ts`: a whitespace-only line (`"a\n  \nb"`, and a tab-only line) round-trips through `highlightMarkdown` with every character intact -- i.e. the rendered HTML's per-line textContent joined by `"\n"` equals the source. This is the invariant test that pins defect (2).
- `src/lib/caret.test.ts`: `getCaretRange` over a non-collapsed selection spanning two lines returns the start/end offsets counting the joining `"\n"`; a collapsed selection returns `start === end === getCaret()`; a selection outside the editor returns `null`.
- `src/components/NotePane.test.tsx` (jsdom does not implement native contenteditable editing, so these test exactly our intercept path -- which is the point of the fix):
  - Space at a caret inside the first of two lines inserts a space **into that line** and leaves the line count at 2 (the reported "makes a new line" symptom).
  - Space on a line with nothing under it keeps the character (the reported "does nothing" symptom), and the debounced save PUTs the text with the space.
  - Tab inserts `"\t"` at the caret and the event is defaultPrevented (focus stays); Shift+Tab is **not** defaultPrevented.
  - A Space typed over a non-collapsed selection replaces the selected text.
  - An `isComposing` Space keydown is not intercepted (the IME still owns it).

## Out of scope

Shift+Tab as outdent, Tab-to-indent-a-whole-selection, list auto-continuation on Enter, and any change to the save/conflict machinery.

## Verification

`npm test` for the units above, then drive the real app (Tab/Space at end of line, mid-line, on an empty line, over a selection, on the last line, with an IME) and confirm the note round-trips and autosaves what is on screen.
