import { describe, expect, it } from "vitest";
import { getCaret, readNoteText, setCaret, setEditorText } from "./caret";

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
});
