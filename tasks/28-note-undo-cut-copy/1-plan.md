# 28 - Ctrl+Z / Ctrl+X / Ctrl+C in the note

## Goal

Three keyboard shortcuts in the note editor, all scoped to the note contenteditable (`#note-input`) and nothing else in the app:

- **Ctrl+Z**: roll back the last edit (undo).
- **Ctrl+X**: cut the current line (remove it and put it on the clipboard).
- **Ctrl+C**: copy the current line to the clipboard.

"Current line" is the line the caret sits on. Ctrl (and Cmd, the same physical shortcut on macOS) only; Ctrl+Shift+*, Ctrl+Alt+* and the rest keep falling through to the browser.

## Why none of this works today

The note is an imperative contenteditable: every input repaints the whole editor through `setEditorText`, which rewrites `root.innerHTML` (`src/lib/caret.ts:94`, `NotePane.tsx:57-60`, `226-230`). Two consequences drive the entire task:

1. **The browser's native undo stack is dead.** A full `innerHTML` rewrite on every keystroke destroys the editing history the browser would undo against, and a native Ctrl+Z would restore DOM that our model (one `.md-line` element per line -- THE LINE INVARIANT, `caret.ts:1-7`) never produced. So undo cannot be delegated: the note has to keep its own history of its own logical text.
2. **Native cut cannot be trusted with the DOM either.** A native Ctrl+X deletes DOM ranges directly, which can merge or strand line elements; our repaint would then re-read whatever structure it left. And in any case native cut/copy operate on the *selection*, while the task asks for **the current line when nothing is selected** -- a selection the user never made.

So all three shortcuts are handled by us, in `onKeyDown`, `preventDefault`-ed, and expressed as edits of the **logical text** (`readNoteText` -> new string -> `paint`), exactly like Enter/Space/Tab/paste already are (`NotePane.tsx:180-188`, `231-249`). That is the existing rule of this component -- *any key that changes the text is spliced by us, never by the browser* -- and this task simply extends it to three more keys.

## The single idea: the note's history is a stack of logical-text snapshots

Undo does not need to know what the edit *was*; it only needs the text (and caret) as it stood before. Since the component already funnels every write through one function (`paint(text, caret)`), a snapshot is just `{ text, caret }`, and undo is "paint the previous snapshot". No diffing, no DOM history, no dependence on the browser.

The one design question is **granularity**: snapshotting per keystroke would make Ctrl+Z revert one character at a time (a widely-hated undo). The rule, standard in editors and cheap to state:

- Consecutive **typing** (plain `onInput`) coalesces into one entry while the pauses stay under `NOTE_UNDO_COALESCE_MS` -- one Ctrl+Z drops a typed run, not a letter.
- Any **structural** edit -- Enter, Tab, paste, cut, and the end of an IME composition -- is its own entry and closes the run before it. These are the boundaries a user thinks in.
- Loading or adopting remote text (`adoptNote`, `loadNote`, conflict "use theirs") **resets** the history to that text as the new base. Undo is for the user's own edits; it must never resurrect text the server replaced, and it must never undo *past* what is on the server. ("Keep mine" changes only the save base, not the text, so it leaves history alone.)

History is capped (`NOTE_UNDO_LIMIT`) so a long session cannot grow it without bound; the oldest entries drop.

Redo (Ctrl+Shift+Z / Ctrl+Y) is **out of scope** -- the task says roll back. The stack keeps an index rather than popping, so redo stays a small addition later.

## Whole-line semantics for cut/copy

With a **collapsed** caret, the target is the caret's line:

- **Copy** puts `line + "\n"` on the clipboard -- the trailing newline is what makes a subsequent paste re-insert a whole line instead of splicing a fragment mid-line. This matches VS Code / JetBrains line-copy.
- **Cut** copies that same payload and removes the line together with its trailing `"\n"`; on the **last** line (no trailing newline to eat) it removes the *preceding* `"\n"` instead, so cutting the last line does not leave an empty line behind. The caret lands at the start of the line that moved up (clamped to the text length when the note becomes empty).
- Cutting the only line of a one-line note leaves the note empty (and dirty, so it saves).

With a **non-collapsed** selection, Ctrl+C copies the selected text verbatim and Ctrl+X copies-and-removes it, i.e. the ordinary meaning. We still handle it ourselves rather than letting the browser do it, so cut has exactly one code path (splice `""` over the range) and cannot damage the line structure.

## Clipboard access

`navigator.clipboard.writeText` is the write path: it is available in the Tauri webview and on localhost (both secure contexts) and the keydown is a user gesture. It is asynchronous and can reject (webview policy, no permission), so a `writeClipboard` helper falls back to the legacy hidden-`<textarea>` + `document.execCommand("copy")` route, and reports failure as a note status (`Could not copy: …`, the existing error-status idiom). The cut's text removal is *not* rolled back on a clipboard failure -- the edit is already in the undo stack, so Ctrl+Z is the recovery, and the error is visible.

If the webview turns out to block `navigator.clipboard` entirely, the fix is the `@tauri-apps/plugin-clipboard-manager` plugin plus a capability entry (`src-tauri/capabilities/default.json` currently grants only `core:default` + `opener:default`). **I would need you to install that plugin** -- the plan assumes we do not need it, and this is the fallback if verification shows otherwise.

## Changes

### `src/config.ts`

- `NOTE_UNDO_COALESCE_MS = 500` -- typing pause that closes an undo entry.
- `NOTE_UNDO_LIMIT = 200` -- max history entries.

Named next to `NOTE_SAVE_DELAY_MS` (`config.ts:39`), the file that already owns every timing.

### `src/lib/history.ts` (new, pure)

A small snapshot stack over `{ text, caret: number | null }`, with no DOM and no React in it, so the coalescing rules are unit-testable in isolation:

- `createHistory(text): History` -- base entry, index 0.
- `record(h, text, caret, kind: "type" | "chunk", now)` -- ignores a no-op (text unchanged); merges into the top entry when `kind === "type"`, the previous record was also `"type"`, and `now - lastAt < NOTE_UNDO_COALESCE_MS`; otherwise appends a new entry (trimming to `NOTE_UNDO_LIMIT`). `"chunk"` never merges and never merges into.
- `undo(h): Entry | null` -- steps the index back and returns that snapshot, or `null` at the base.
- `reset(h, text)` -- drop everything; `text` becomes the new base.

`now` is a parameter (injected, not `Date.now()` inside) so the coalescing tests are deterministic.

### `src/lib/noteEdit.ts` (new, pure)

The line arithmetic, kept out of the component for the same reason `markdown.ts`/`caret.ts` are:

- `lineBounds(text, pos): { start: number; end: number }` -- the caret's line, `end` exclusive of the `"\n"`.
- `cutRange(text, start, end): { text: string; caret: number; copied: string }` -- given a selection range, or the line bounds when collapsed, returns the payload to copy, the resulting text, and the resulting caret, implementing the trailing/preceding-newline rule above. Copy uses the same `copied` value and discards the rest.

### `src/lib/clipboard.ts` (new)

- `writeClipboard(text): Promise<void>` -- `navigator.clipboard.writeText` when present, otherwise the hidden-textarea + `execCommand("copy")` fallback; throws when both fail.

### `src/components/NotePane.tsx`

- A `history` ref seeded on load; `adoptNote` calls `reset` (this is the single place remote text becomes the editor's text, so it is the only reset site).
- `record` is called from the three places text changes: `onInput` (kind `"type"`), `spliceNote` (kind `"chunk"` -- covers Enter/Space/Tab/paste; Space and Tab are coalescable in spirit but sit on the structural path, and one Ctrl+Z per space is not worth splitting the path for), and `onCompositionEnd` (kind `"chunk"`).
- `undoNote()` -- `undo(history)`; when non-null: `paint(entry.text, entry.caret)`, `setNoteStatus("Editing…")`, `scheduleNoteSave()` (an undo is an edit: it must autosave like any other, and against a conflict it behaves exactly as typing does).
- `clipLine(cut: boolean)` -- read text + `getCaretRange`, derive the range (collapsed -> `lineBounds`), `writeClipboard(copied)`, and for cut `paint(next.text, next.caret)` + `Editing…` + `scheduleNoteSave()`.
- `onKeyDown` gains a modifier block **before** the existing "bail out on Ctrl/Meta/Alt" line (`NotePane.tsx:232`), matching `z` / `x` / `c` with Ctrl-or-Meta and no Shift/Alt, each `preventDefault`-ed. The composition guard stays first: an IME owns its keys.
- The editor stays unfocused-safe: the shortcuts live on the editor's own `onKeyDown`, so they cannot fire while the caret is in the todo pane.

## Tests

- `src/lib/history.test.ts`: a typed run inside the window coalesces to one entry and one Ctrl+Z reverts the run; a pause past `NOTE_UNDO_COALESCE_MS` splits entries; a `"chunk"` always splits; `undo` at the base returns `null`; `reset` erases the past; the limit drops the oldest.
- `src/lib/noteEdit.test.ts`: `lineBounds` for first / middle / last line, an empty line, and a caret at a line end; `cutRange` collapsed on a middle line eats the trailing `"\n"`; on the last line eats the preceding `"\n"`; on the only line empties the note; over a real selection cuts exactly the selection; `copied` carries the trailing `"\n"` in the collapsed case.
- `src/lib/clipboard.test.ts`: uses `navigator.clipboard.writeText` when it exists; falls back to `execCommand` when it does not; throws when both fail.
- `src/components/NotePane.test.tsx` (jsdom, driving our own intercept path -- the same approach the existing Space/Tab/paste tests take): Ctrl+C copies `"line\n"` and leaves the text and the save timer untouched; Ctrl+X removes the line, shows `Editing…` and PUTs the shortened note; Ctrl+Z after a typed run restores the previous text and caret and PUTs it; Ctrl+Z with nothing to undo is a no-op; Ctrl+Z after a remote adopt does not resurrect the pre-adopt text; Ctrl+Shift+Z is not intercepted.

## Out of scope

Redo, a visible history UI, Ctrl+D / line-move shortcuts, undo across a page reload, and any keyboard handling outside the note pane.

## Verification

`npm test`, then drive the real app: type a run and Ctrl+Z it; Ctrl+Z past the load base (nothing happens); Ctrl+X / Ctrl+C on the first, a middle, and the last line, then paste back with Ctrl+V and confirm the line returns whole; cut with a selection; confirm the status bar reaches `Saved` after each; confirm the clipboard payload is right in a **Tauri build** as well as the browser (this is where `navigator.clipboard` could differ).
