import { describe, expect, it } from "vitest";
import { setEditLine } from "./editLine";

// Build an editor-like root of line <div>s, each holding one text node, mirroring the markdown.ts output
// shape (direct-child lines). Returns the root and its line elements for caret-node lookups.
function editorWithLines(...texts: string[]): { root: HTMLDivElement; lines: HTMLDivElement[] } {
  const root = document.createElement("div");
  const lines = texts.map((t) => {
    const div = document.createElement("div");
    div.className = "md-line";
    div.appendChild(document.createTextNode(t));
    root.appendChild(div);
    return div;
  });
  return { root, lines };
}

const edited = (root: HTMLElement) =>
  Array.from(root.children).map((c) => c.classList.contains("md-edit"));

describe("setEditLine", () => {
  it("tags only the line containing the caret node", () => {
    const { root, lines } = editorWithLines("one", "two", "three");
    setEditLine(root, lines[1].firstChild); // a text node inside line 2
    expect(edited(root)).toEqual([false, true, false]);
  });

  it("moves the tag when the caret moves to another line (the old line is cleared)", () => {
    const { root, lines } = editorWithLines("one", "two", "three");
    setEditLine(root, lines[1].firstChild);
    setEditLine(root, lines[2].firstChild);
    expect(edited(root)).toEqual([false, false, true]);
  });

  it("accepts the line element itself, not just a descendant text node", () => {
    const { root, lines } = editorWithLines("one", "two");
    setEditLine(root, lines[0]);
    expect(edited(root)).toEqual([true, false]);
  });

  it("clears every line when the caret node is null (editor unfocused)", () => {
    const { root, lines } = editorWithLines("one", "two");
    setEditLine(root, lines[0].firstChild);
    setEditLine(root, null);
    expect(edited(root)).toEqual([false, false]);
  });

  it("tags nothing when the node is outside the editor root", () => {
    const { root } = editorWithLines("one", "two");
    const stray = document.createElement("div");
    stray.appendChild(document.createTextNode("elsewhere"));
    setEditLine(root, stray.firstChild);
    expect(edited(root)).toEqual([false, false]);
  });
});
