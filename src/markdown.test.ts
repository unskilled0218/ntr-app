import { describe, expect, it } from "vitest";
import { escapeHtml, highlightMarkdown } from "./markdown";
import { readNoteText } from "./lib/caret";

// THE LINE INVARIANT: rendering the source then reading it back must return the exact source,
// because highlightMarkdown only wraps characters (markers kept), never adds/removes/reorders any.
function roundTrips(src: string) {
  const root = document.createElement("div");
  root.innerHTML = highlightMarkdown(src);
  expect(readNoteText(root)).toBe(src);
}

describe("highlightMarkdown — line invariant (textContent === source)", () => {
  it("round-trips every supported block kind", () => {
    roundTrips("# Heading one");
    roundTrips("## Heading two");
    roundTrips("plain paragraph");
    roundTrips("**bold** and *italic* and _em_ and __strong__");
    roundTrips("inline `code` here");
    roundTrips("a [link](https://example.com) inline");
    roundTrips("> a quote");
    roundTrips("- bullet one");
    roundTrips("1. ordered item");
    roundTrips("---");
    roundTrips("");
  });

  it("round-trips a multi-line document including a fenced code block", () => {
    const doc = ["# Title", "", "Some **bold** text.", "", "```", "code <b> & stuff", "```", "", "- a", "- b"].join("\n");
    roundTrips(doc);
  });

  it("round-trips HTML-significant characters without injecting markup", () => {
    roundTrips("5 < 6 && 7 > 3 with \"quotes\" and 'apostrophes'");
  });
});

describe("highlightMarkdown — styling classes", () => {
  it("tags headings by level", () => {
    expect(highlightMarkdown("# h")).toContain("md-h1");
    expect(highlightMarkdown("### h")).toContain("md-h3");
  });

  it("treats fence-body lines as code regardless of content", () => {
    const html = highlightMarkdown(["```", "# not a heading", "```"].join("\n"));
    // The middle line is inside the fence, so it is md-code, not md-h1.
    expect(html).toContain("md-code");
    expect(html).not.toContain("md-h1");
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters and preserves length-by-decoding", () => {
    expect(escapeHtml("<a & b>")).toBe("&lt;a &amp; b&gt;");
    const root = document.createElement("div");
    root.innerHTML = escapeHtml("<script> & \"x\"");
    // Decoded back, textContent equals the original — the count-preserving guarantee.
    expect(root.textContent).toBe("<script> & \"x\"");
  });
});
