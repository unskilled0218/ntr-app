// The caret / line-offset helpers that implement THE LINE INVARIANT, ported from web/app.js.
// Kept together with markdown.ts because they are its exact inverse and must not drift.
//
// THE LINE INVARIANT (one home for the "lines join with a single \n" decision): the editor's
// logical text is each direct-child line's textContent joined by exactly one "\n". readNoteText
// performs that join; getCaret/setCaret count this same per-line length via lineLen, so they are
// exact inverses of the join and cannot drift.

import { highlightMarkdown } from "../markdown";

const lineLen = (line: Element) => (line.textContent ?? "").length + 1; // +1 = the joining "\n"

// The editor's logical text — the raw Markdown, since highlighting only wraps characters, never
// changes them. What autosave reads and what the caret offsets count against.
export function readNoteText(root: HTMLElement): string {
  return Array.from(root.children)
    .map((line) => line.textContent ?? "")
    .join("\n");
}

// Characters before one DOM boundary point, counting one "\n" per line boundary — the inverse of
// the readNoteText join, so an offset survives a re-render unchanged.
function offsetOf(root: HTMLElement, container: Node, nodeOffset: number): number {
  let offset = 0;
  for (const line of Array.from(root.children)) {
    if (line === container || line.contains(container)) {
      const within = document.createRange();
      within.setStart(line, 0);
      within.setEnd(container, nodeOffset);
      return offset + within.toString().length; // no block boundaries inside a line
    }
    offset += lineLen(line); // same per-line length the join implies (THE LINE INVARIANT)
  }
  return offset;
}

export function getCaretRange(root: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: offsetOf(root, range.startContainer, range.startOffset),
    end: offsetOf(root, range.endContainer, range.endOffset),
  };
}

// Characters before the caret, counting one "\n" per line boundary. null when the caret is not in
// the editor (nothing to restore).
export function getCaret(root: HTMLElement): number | null {
  return getCaretRange(root)?.start ?? null;
}

// Put the caret at character offset `pos` within `line`, walking its descendant text nodes. An
// empty line (just <br>) has no text node, so the caret collapses to the line itself.
function placeInLine(line: Element, pos: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let acc = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    if (acc + node.length >= pos) {
      range.setStart(node, pos - acc);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    acc += node.length;
  }
  range.selectNodeContents(line);
  range.collapse(false); // end of an empty/short line
  sel.removeAllRanges();
  sel.addRange(range);
}

// Place the caret at logical offset `pos`, finding its line then the spot within it.
export function setCaret(root: HTMLElement, pos: number): void {
  for (const line of Array.from(root.children)) {
    const len = (line.textContent ?? "").length;
    if (pos <= len) return placeInLine(line, pos);
    pos -= len + 1; // step over this line and its joining "\n" (THE LINE INVARIANT)
  }
  if (root.lastElementChild) {
    placeInLine(root.lastElementChild, (root.lastElementChild.textContent ?? "").length);
  }
}

// The single write path: render `text` into the editor and (optionally) restore the caret to
// character offset `caret`. Load, every keystroke, Enter, and paste all go through here, so "what
// the editor shows" and "where the caret is" have one home. The is-empty class drives the CSS
// placeholder (a contenteditable is never CSS :empty once it holds a line).
export function setEditorText(root: HTMLElement, text: string, caret: number | null): void {
  root.innerHTML = highlightMarkdown(text);
  root.classList.toggle("is-empty", text === "");
  if (caret != null) setCaret(root, caret);
}
