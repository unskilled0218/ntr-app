// Pure helpers for the add form, the label modal, and label removal, ported from web/app.js. No
// DOM, no side effects, so they are trivially unit-testable (the behaviours most likely to
// regress subtly). Depends only on config — never on the transport shim (api.ts).

import { KIND_LIST, KINDS, type Kind } from "./config";

export function unionLabels(remembered: string[], derived: string[]): string[] {
  return [...new Set([...remembered, ...derived])];
}

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

// Remove the single whitespace-delimited token `prefix+name` from a raw todo.txt line, preserving
// every other token (the priority, an x/completion prefix, dates, a due: tag, and other labels)
// and collapsing the gap. Whole-token equality is deliberate — NOT bareDescription's substring
// replace — so removing +work never touches +workshop, and the word homework (not a +token) is
// left alone. Also normalizes internal whitespace on a rewritten line (canonical single spacing);
// untouched lines are never visited.
export function removeLabel(raw: string, kind: Kind, name: string): string {
  const token = KINDS[kind].prefix + name;
  return raw
    .split(/\s+/)
    .filter((t) => t !== token)
    .join(" ")
    .trim();
}

// The fields planLabelRemoval reads — a structural subset of api.Task, declared here so this pure
// module needs no dependency on the transport shim (an Interface Segregation fit: it asks for
// exactly the four fields it uses).
type Tagged = { id: number; projects: string[]; contexts: string[]; raw: string };

// The pure removal decision: for every task that actually carries `name` (by its parsed
// projects/contexts, not a raw substring), the id and the rewritten line with the token stripped.
// api.Task is structurally assignable to Tagged, so callers pass their Task[] unchanged.
export function planLabelRemoval(
  tasks: Tagged[],
  kind: Kind,
  name: string,
): { id: number; text: string }[] {
  const field = kind === "project" ? "projects" : "contexts";
  return tasks
    .filter((t) => t[field].includes(name))
    .map((t) => ({ id: t.id, text: removeLabel(t.raw, kind, name) }));
}
