// Pure helpers for the add form and the label modal, ported from web/app.js. No DOM, no side
// effects, so they are trivially unit-testable (the behaviours most likely to regress subtly).

import { KIND_LIST, KINDS } from "./config";

// Fields the add form contributes to a todo.txt line.
export interface ComposeFields {
  priority: string;
  description: string;
  project: string;
  context: string;
  due: string;
}

// Build a todo.txt line from the form controls. Priority must lead the line; the rest of the
// order is cosmetic. Each label select contributes at most one label (picker-only single-select).
export function composeText(f: ComposeFields): string {
  const parts: string[] = [];
  if (f.priority) parts.push(`(${f.priority})`);
  const desc = f.description.trim();
  if (desc) parts.push(desc);
  for (const kind of KIND_LIST) {
    const value = kind === "project" ? f.project : f.context;
    if (value) parts.push(`${KINDS[kind].prefix}${value}`);
  }
  if (f.due) parts.push(`due:${f.due}`);
  return parts.join(" ").trim();
}

// Strip the structured tokens already parsed into projects/contexts/tags from the raw
// description text, leaving only the human-readable task text. Strips exact tokens so
// URLs and other +/@/: characters outside parsed fields are left intact.
export function bareDescription(
  description: string,
  projects: string[],
  contexts: string[],
  tags: Record<string, string>,
): string {
  let desc = description;
  for (const p of projects) desc = desc.replace(`+${p}`, "");
  for (const c of contexts) desc = desc.replace(`@${c}`, "");
  for (const [k, v] of Object.entries(tags)) desc = desc.replace(`${k}:${v}`, "");
  return desc.trim().replace(/\s+/g, " ");
}

// Validate a label name typed in the modal. Returns { name } on success or { error } on
// rejection. Strips leading +/@ sigils a user may type, then forbids whitespace and any +/@/:
// in the bare name (a key:value name would compose into a tag, not a label).
export function parseLabelInput(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/^[+@]+/, "");
  if (!name) return { error: "Name is required." };
  if (/\s/.test(name)) return { error: "No spaces allowed in a project or context." };
  if (/[+@:]/.test(name)) return { error: "A project or context cannot contain + @ or :" };
  return { name };
}
