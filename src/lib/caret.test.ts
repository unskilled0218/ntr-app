import { describe, expect, it } from "vitest";
import { getCaret, getCaretRange, readNoteText, setCaret, setCaretRange, setEditorText } from "./caret";

function editorWith(text: string): HTMLDivElement {
  const root = document.createElement("div");
  document.body.appendChild(root);
  setEditorText(root, text, null);
  return root;
}

describe("readNoteText / setEditorText", () => {
  it("is the identity round-trip for multi-line text", () => {
    const text = ["# Title", "", "line with **bold**", "- item"].join("\n");
    expect(readNoteText(editorWith(text))).toBe(text);
  });

  it("marks an empty editor with is-empty for the CSS placeholder", () => {
    const root = editorWith("");
    expect(root.classList.contains("is-empty")).toBe(true);
    setEditorText(root, "x", null);
    expect(root.classList.contains("is-empty")).toBe(false);
  });
});

describe("caret line invariant (getCaret is the inverse of setCaret)", () => {
  it("restores a logical offset across a re-render", () => {
    const text = ["hello world", "second line", "third"].join("\n");
    const root = editorWith(text);
    // Offsets spanning line boundaries: start, mid first line, just after first "\n", deep.
    for (const pos of [0, 5, 11, 12, 18, text.length]) {
      setCaret(root, pos);
      expect(getCaret(root)).toBe(pos);
    }
  });

  it("reports non-collapsed ranges across lines using logical offsets", () => {
    const root = editorWith("abcd\nefgh");
    const [first, second] = Array.from(root.children);
    const range = document.createRange();
    range.setStart(first.firstChild!, 1);
    range.setEnd(second.firstChild!, 2);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(getCaretRange(root)).toEqual({ start: 1, end: 7 });
  });

  it("reports collapsed ranges at the same offset as getCaret", () => {
    const root = editorWith("abcd\nefgh");
    setCaret(root, 6);

    expect(getCaretRange(root)).toEqual({ start: 6, end: 6 });
    expect(getCaret(root)).toBe(6);
  });

  it("maps editor child boundaries and empty line element boundaries", () => {
    const root = editorWith("link\n\ntail");
    const selection = window.getSelection()!;
    const range = document.createRange();
    for (const [node, offset, expected] of [[root, 0, 0], [root, 1, 5], [root, 2, 6], [root, 3, 10], [root.children[1], 0, 5]] as const) {
      range.setStart(node, offset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      expect(getCaret(root)).toBe(expected);
    }
  });

  it("restores a logical range across highlighted spans and lines", () => {
    const root = editorWith("**bold**\nplain");
    setCaretRange(root, 2, 12);

    expect(getCaretRange(root)).toEqual({ start: 2, end: 12 });
  });

  it("restores ranges across an empty line and clamps endpoints", () => {
    const root = editorWith("one\n\nthree");
    setCaretRange(root, -10, 99);

    expect(getCaretRange(root)).toEqual({ start: 0, end: 10 });
  });

  it("returns null when the selection is outside the editor", () => {
    const root = editorWith("inside");
    const outside = document.createElement("div");
    outside.textContent = "outside";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    expect(getCaretRange(root)).toBeNull();
  });
});
