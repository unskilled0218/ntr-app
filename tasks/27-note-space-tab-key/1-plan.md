# 27 - Space and Tab in the note insert a new line instead of the character

## Bug

Reported in `~/workdir/agents/command.md`: "space and tab doesn't work on
note - Both make new line". In the note editor, pressing Space or Tab
produces a new line instead of a space or a tab character.

## Root cause

`NotePane.tsx`'s `onKeyDown` only special-cases `Enter`
(`src/components/NotePane.tsx:231-236`): it calls `preventDefault()` and
routes the newline through `spliceNote("\n")`, the app's own controlled
insert path. Every other key, including Space and Tab, is left to the
browser's native contenteditable editing command for that key and only
picked up afterwards by `onInput` -> `rerenderNote()`.

The editor's DOM is not a normal contenteditable paragraph flow; it is a
flat "one `<div class="md-line">` per source line" structure that
`setEditorText`/`readNoteText` treat as the ground truth
(`src/lib/caret.ts:1-19`, the file's own "THE LINE INVARIANT" comment).
Native contenteditable editing commands are designed around a regular
paragraph/`<br>` model, not this shape. Browsers (this app ships across
several WebView engines: WebKit on macOS/iOS, WebKitGTK on Linux, WebView2
on Windows, plus Android's system WebView per the mobile view added in task
26) are inconsistent about which native command a bare Space or Tab keypress
maps to when the caret sits at a block-boundary inside a div-per-line
editor; several of them fall back to an `insertParagraph`/`insertLineBreak`
command instead of `insertText`, which is exactly the symptom described:
the key that should add one character instead splits the line in two. Enter
already had to be pulled out of native handling for the same structural
reason; Space and Tab need the same treatment.

Plain character keys (letters, digits, punctuation) are not affected
because native single-character insertion stays within the current line's
text node and never touches a block boundary, so `onInput` -> `rerenderNote`
picks it up cleanly. Space and Tab are the two keys whose native command
choice is documented as caret-position-sensitive at block boundaries, which
matches "both" failing the same way while ordinary typing works.

## Fix

Extend the existing `onKeyDown` handler in `src/components/NotePane.tsx`
with the same pattern already used for Enter, so Space and Tab never reach
native contenteditable handling and always go through `spliceNote`, the
single controlled-insert path:

```tsx
onKeyDown={(e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    spliceNote("\n");
  } else if (e.key === " ") {
    e.preventDefault();
    spliceNote(" ");
  } else if (e.key === "Tab") {
    e.preventDefault();
    spliceNote("\t");
  }
}}
```

`spliceNote` already does the right thing for any string: it reads the
logical text, inserts at the caret, repaints, and arms the save debounce
(`src/components/NotePane.tsx:181-187`) - no change needed there.

Tab is treated as a literal `\t` character insert, not list indent/outdent.
`markdown.ts`'s `LIST_ITEM` pattern already tolerates leading whitespace
generically (`/^(\s*)([-*+]|\d+\.)(\s+)(.*)$/`), so a literal tab in a list
line's indent keeps rendering as a list item; no markdown.ts change is
needed. Reinterpreting Tab as indent/outdent on list lines would be a
second, separate feature and is out of scope here - this task is only about
the key inserting the wrong character, not adding new editing behavior.

### CSS: tab-size

`.note-input` (`src/style.css:183-195`) sets `white-space: pre-wrap` but no
`tab-size`, so an inserted `\t` renders at the browser default (8 columns),
inconsistent with this project's own 2-space tab convention. Add `tab-size:
2` next to `white-space: pre-wrap` so a literal tab in the note renders at
the same width as everywhere else in this codebase.

## Tests

Extend `src/components/NotePane.test.tsx`, same pattern as the existing
autosave test (render, `flushMicrotasks` for `loadNote`, act on the editor,
run timers, assert on `putNote`). `fireEvent.keyDown` on `#note-input`
followed by asserting the saved text, mirroring how `pasteInto` already
drives the controlled-insert path in this suite:

- Space: `fireEvent.keyDown(editor, { key: " " })` after seeding some text
  (via `pasteInto`) inserts a literal space at the caret, not a line break -
  assert the debounced `putNote` call's argument has no extra `\n` and does
  contain the space.
- Tab: `fireEvent.keyDown(editor, { key: "Tab" })` inserts a literal `\t`
  the same way - assert `putNote`'s argument contains `\t` and no extra
  `\n`.
- Both events call `preventDefault` (assert
  `event.defaultPrevented`/`isDefaultPrevented()` on the fired event, the
  same check Enter's handling would need if it were tested) so native
  handling is confirmed bypassed, not just coincidentally correct.

No `src/lib/caret.ts` or `src/markdown.ts` test changes - neither's
behavior changes; `spliceNote` and `LIST_ITEM` already handle arbitrary
inserted characters, including tab and space.

## Verification

- `npm test` - existing suites stay green; new Space/Tab `NotePane` cases
  pass.
- `npm run build` (tsc + vite) - no type or bundle change beyond the two
  new `else if` branches and one CSS line.
- Manual: type a line, press Space mid-word and at end of line - a space is
  inserted, caret advances by one, no new line appears. Press Tab - a tab
  character is inserted (visibly indented ~2 columns), no new line appears,
  and focus stays in the editor (does not tab away to the next control).
  Repeat on an empty note (caret on the placeholder's single empty line) to
  cover the block-boundary case the bug report points at.
- No version bump - this is a bug fix with no user-visible feature change,
  matching the precedent of the previous note-editor bug fix (link URL
  emphasis mangling, commit ad3258f), which also did not bump
  package.json/tauri.conf.json.

## Out of scope

- No Tab-as-indent/outdent behavior on list lines - literal character
  insert only, as decided above.
- No change to how Enter is handled - already correct, untouched.
- No change to `caret.ts`/`markdown.ts` - both already handle arbitrary
  characters, tab and space included, without modification.
