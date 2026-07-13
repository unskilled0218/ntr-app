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

  it("round-trips whitespace-only lines without dropping their characters", () => {
    roundTrips("a\n  \nb");
    roundTrips("a\n\t\nb");
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

describe("highlightMarkdown — links", () => {
  it("renders the text as an <a> with the raw URL on data-href, keeping markers and URL as tagged text", () => {
    const html = highlightMarkdown("see [docs](https://x.io/a?b=1&c=2)");
    // The text becomes a clickable <a>; the URL rides on data-href (escaped & decodes back to raw).
    expect(html).toContain('<a class="md-link" data-href="https://x.io/a?b=1&amp;c=2">docs</a>');
    // The brackets are kept but tagged so the CSS can hide just link syntax.
    expect(html).toContain('class="md-mark md-link-mark"');
    // The URL is also kept as visible-when-editing text (so it round-trips and stays editable).
    expect(html).toContain('<span class="md-url">https://x.io/a?b=1&amp;c=2</span>');
  });

  it("keeps every link character so the line invariant holds (markers/URL hidden, not removed)", () => {
    const src = "a [link](https://example.com) inline";
    const root = document.createElement("div");
    root.innerHTML = highlightMarkdown(src);
    expect(readNoteText(root)).toBe(src); // textContent === source, brackets and URL included
  });

  it("emits a URL containing _ and * verbatim, never mangling it into emphasis", () => {
    // A real-world URL whose path/fragment holds underscores (and an asterisk) must reach data-href and
    // the md-url span unchanged — emphasis must not rewrite _docs_ or *x* inside the link.
    const url = "https://h.io/md_docs_2awesome__sunshine.html#a_b*c*d";
    const html = highlightMarkdown(`see [v](${url})`);
    expect(html).toContain(`<a class="md-link" data-href="${url}">v</a>`);
    expect(html).toContain(`<span class="md-url">${url}</span>`);
    expect(html).not.toContain("md-em"); // no italic injected into the URL
    expect(html).not.toContain("md-strong"); // no bold injected into the URL
    // And it still round-trips (the underscores/asterisks are preserved as text).
    const root = document.createElement("div");
    root.innerHTML = html;
    expect(readNoteText(root)).toBe(`see [v](${url})`);
  });

  it("still applies emphasis to text outside a link on the same line", () => {
    const html = highlightMarkdown("**bold** then [t](http://x) and _em_");
    expect(html).toContain("md-strong"); // **bold** before the link
    expect(html).toContain("md-em"); // _em_ after the link
    expect(html).toContain('data-href="http://x"');
  });

  it("escapes a hostile URL so it cannot break out of the data-href attribute", () => {
    const html = highlightMarkdown('[x](http://e/"><img src=y onerror=z>)');
    const a = html.slice(html.indexOf('data-href="') + 'data-href="'.length, html.indexOf('">x</a>'));
    // No raw quote or angle bracket survives inside the attribute value — no markup injection.
    expect(a).not.toContain('"');
    expect(a).not.toContain("<");
    expect(a).not.toContain(">");
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
