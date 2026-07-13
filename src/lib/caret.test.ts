import { describe, expect, it } from "vitest";
import { getCaret, getCaretRange, readNoteText, setCaret, setEditorText } from "./caret";

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
