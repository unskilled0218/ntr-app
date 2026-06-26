// In-place live Markdown highlighter, ported verbatim (in spirit) from web/app.js lines 686-806.
// The note is stored and served as raw Markdown and edited in place: the editor IS the preview.
// highlightMarkdown wraps each character of the source in styling spans WITHOUT adding, removing,
// or reordering a character, so the editor's text content stays exactly the raw Markdown (markers
// kept, just dimmed). Everything here is pure (string in, HTML string out).

// Block line-patterns named once so each "what marks this block" decision has a single home.
// None carry the `g` flag, so reusing them with `.test`/`.match` is stateless.
const LIST_ITEM = /^(\s*)([-*+]|\d+\.)(\s+)(.*)$/; // leading indent, bullet, gap, text
const FENCE = /^```/; //                             a fenced-code delimiter line
const QUOTE_MARKER = /^(>\s?)(.*)$/; //              a blockquote line: marker, then text
const HEADING = /^(#{1,6}\s+)(.*)$/; //              heading: hashes+gap marker, then text

// Escape the HTML-significant characters so note text can never inject markup when it becomes
// innerHTML. Because the browser decodes these entities back in textContent (&gt; -> >), escaping
// preserves the character count — the line invariant still holds.
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Classify the block a line begins — the single source of "what kind of line is this".
function blockKind(line: string): string {
  if (line.trim() === "") return "blank";
  if (FENCE.test(line)) return "fence";
  if (HEADING.test(line)) return "heading";
  if (/^(---|\*\*\*|___)\s*$/.test(line)) return "hr";
  if (QUOTE_MARKER.test(line)) return "quote"; // ^>-anchored, so this implies startsWith(">")
  if (LIST_ITEM.test(line)) return "list";
  return "para";
}

// A dimmed, kept marker (e.g. `#`, `**`, `>`); the one place marker spans are built.
const mark = (s: string) => `<span class="md-mark">${s}</span>`;

// A dimmed, kept LINK marker (`[`, `](`, `)`): like mark() but additionally tagged so the CSS can hide
// just link syntax (never heading #, bold **, etc.) when the line is not the one being edited.
const linkMark = (s: string) => `<span class="md-mark md-link-mark">${s}</span>`;

// A replace callback that wraps one emphasis run: the fixed marker re-emitted as dimmed marks
// around a styled span, so textContent === the source run.
const emph =
  (marker: string, cls: string) =>
  (_: string, t: string) =>
    `${mark(marker)}<span class="${cls}">${t}</span>${mark(marker)}`;

// One [text](url): the text, the URL, and the whole-match recogniser. The split form carries the `g`
// flag and a capturing group so split() keeps the links as odd segments; LINK (no `g`) re-parses one
// such segment back into its text and URL.
const LINK = /\[([^\]]+)\]\(([^)]+)\)/;
const LINK_SPLIT = /(\[[^\]]+\]\([^)]+\))/g;

// Render one already-escaped [text](url) as its ONE collapsed form: the text becomes an <a> (so it reads
// as a hyperlink and the open gestures can find it), while the `[`, `](`, URL, and `)` are kept as text
// but tagged so the CSS hides them — until the caret's line gains .md-edit, when they reveal for editing
// (see style.css). The raw URL is carried on data-href (NOT href: a real href invites contenteditable's
// own click/drag and URL normalisation; we open via the Tauri opener and identify links by the .md-link
// class). The URL is emitted verbatim into both the attribute and the .md-url span — never run through
// emphasis — so a URL containing `_` or `*` cannot be mangled. `t`/`u` are already HTML-escaped, so `u`
// is safe in the double-quoted attribute and decodes back to the raw URL via el.dataset.href. Every
// character is still emitted, so THE LINE INVARIANT holds.
function renderLink(link: string): string {
  const [, t, u] = link.match(LINK)!;
  return `${linkMark("[")}<a class="md-link" data-href="${u}">${t}</a>${linkMark("](")}<span class="md-url">${u}</span>${linkMark(")")}`;
}

// Wrap bold/italic emphasis on one already-escaped run that contains NO link, re-emitting every marker
// inside an .md-mark span so textContent === the source. Order: bold before italic so ** is not eaten by
// the single-* rule; every branch preserves characters.
function emphasize(run: string): string {
  return run
    .replace(/\*\*([^*]+)\*\*/g, emph("**", "md-strong"))
    .replace(/__([^_]+)__/g, emph("__", "md-strong"))
    .replace(/\*([^*]+)\*/g, emph("*", "md-em"))
    .replace(/_([^_]+)_/g, emph("_", "md-em"));
}

// Format emphasis and links on one already-escaped, non-code run. Links are partitioned out FIRST (the
// odd segments of the split) and rendered verbatim; emphasis is applied only to the remaining non-link
// text. This ordering is essential: a link's URL must be emitted exactly, so running emphasis over the
// link markup (as a chained .replace would) cannot turn an underscore/asterisk inside a URL into <em>.
function formatInline(run: string): string {
  return run
    .split(LINK_SPLIT)
    .map((seg, i) => (i % 2 ? renderLink(seg) : emphasize(seg)))
    .join("");
}

// Inline highlight of one already-escaped run: partition `code` spans (odd segments) from the
// rest. Code keeps its backticks (dimmed) and is not emphasis-formatted; non-code segments go to
// formatInline.
function highlightInline(escaped: string): string {
  return escaped
    .split(/(`[^`]+`)/)
    .map((part, i) =>
      i % 2
        ? `${mark("`")}<span class="md-code-inline">${part.slice(1, -1)}</span>${mark("`")}`
        : formatInline(part),
    )
    .join("");
}

// One renderer per line kind -> that source line's HTML. Each div's textContent equals the source
// line exactly (markers kept), so the lines join back to the raw Markdown; an empty line becomes
// <br> so it keeps height and stays selectable.
const LINE: Record<string, (line: string) => string> = {
  blank: () => `<div class="md-line"><br></div>`,
  code: (line) => {
    const body = escapeHtml(line);
    return `<div class="md-line md-code">${body === "" ? "<br>" : body}</div>`;
  },
  hr: (line) => `<div class="md-line md-hr">${mark(escapeHtml(line))}</div>`,
  heading: (line) => {
    const m = line.match(HEADING)!;
    const [, marker, text] = m;
    return `<div class="md-line md-h${marker.trim().length}">${mark(escapeHtml(marker))}${highlightInline(escapeHtml(text))}</div>`;
  },
  quote: (line) => {
    const m = line.match(QUOTE_MARKER)!;
    const [, marker, text] = m;
    return `<div class="md-line md-quote">${mark(escapeHtml(marker))}${highlightInline(escapeHtml(text))}</div>`;
  },
  list: (line) => {
    const m = line.match(LIST_ITEM)!;
    const [, indent, bullet, gap, text] = m;
    return `<div class="md-line md-li">${escapeHtml(indent)}${mark(escapeHtml(bullet + gap))}${highlightInline(escapeHtml(text))}</div>`;
  },
  para: (line) => `<div class="md-line">${highlightInline(escapeHtml(line))}</div>`,
};

// Render the raw Markdown to the editor's HTML: one block <div> per source line, every character
// preserved. Fenced-code state is tracked across lines so a fence body styles as code regardless
// of its content.
export function highlightMarkdown(src: string): string {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  return lines
    .map((line) => {
      const fence = FENCE.test(line);
      const kind = inFence || fence ? "code" : blockKind(line);
      if (fence) inFence = !inFence;
      return LINE[kind](line);
    })
    .join("");
}
