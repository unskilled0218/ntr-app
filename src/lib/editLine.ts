// Reveal the raw Markdown of the line the caret is on by tagging exactly that line `.md-edit`; every
// other line stays collapsed (its links show as just their text — see markdown.ts / style.css). Pure DOM
// with no selection reading: given the node the caret sits in (or null when the editor is unfocused),
// find its line — a direct child of root — and give only that line the class. Toggling a class never
// moves the caret or fires selectionchange, so this is safe to call as often as the selection changes
// and cannot recurse. It is the inverse of the `.md-edit` CSS rule and the only place that class is set.

export function setEditLine(root: HTMLElement, caretNode: Node | null): void {
  let line: Node | null = caretNode && root.contains(caretNode) ? caretNode : null;
  while (line && line.parentNode !== root) line = line.parentNode;
  for (const child of Array.from(root.children)) child.classList.toggle("md-edit", child === line);
}
