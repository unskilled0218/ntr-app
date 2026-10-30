// Pure helpers for the add form, the label modal, and label removal, ported from web/app.js. No
// DOM, no side effects, so they are trivially unit-testable (the behaviours most likely to
// regress subtly). Depends only on config and pure date helpers — never on the transport shim (api.ts).

import { KINDS, type Kind } from "./config";
import { isTaskDate, type TaskDateMetadata } from "./lib/taskDates";

export function unionLabels(remembered: string[], derived: string[]): string[] {
  return [...new Set([...remembered, ...derived])];
}

// Fields the add form contributes to a todo.txt line.
export interface ComposeFields {
  description: string;
  project: string;
  contexts: string[];
  due: string;
}

// Build a todo.txt line from the form controls. Each label select contributes at most one label.
export function composeText(f: ComposeFields): string {
  const parts: string[] = [];
  validateDescription(f.description);
  const desc = f.description.trim();
  if (desc) parts.push(desc);
  if (f.project) parts.push(`+${f.project}`);
  const descriptionTokens = new Set(desc.split(/\s+/));
  for (const context of new Set(f.contexts)) {
    if (!descriptionTokens.has(`@${context}`)) parts.push(`@${context}`);
  }
  if (f.due) parts.push(`due:${f.due}`);
  return parts.join(" ").trim();
}

// Only the metadata needed for editing: no transport dependency or duplicate form state.
interface EditableTask {
  completed: boolean;
  raw: string;
  completion_date: string | null;
  creation_date: string | null;
  description: string;
  contexts: string[];
  projects: string[];
  tags: Record<string, string>;
}

export function validateDescription(description: string): void {
  if (/^\([A-Z]\)(?:\s|$)/.test(description.trim())) {
    throw new Error("Description cannot begin with (A)–(Z): this position is reserved for legacy data. Move the token later in the text.");
  }
}

// Validate raw independently of the editable body; DTO dates remain authoritative.
function legacyPrefix(task: EditableTask): string | null {
  const fail = () => { throw new Error("Cannot safely edit this task: raw text is missing or inconsistent. Reload or upgrade the server."); };
  if (typeof task.raw !== "string" || !task.raw.trim() || /[\r\n]/.test(task.raw)) return fail();
  let rest = task.raw.trim();
  const completed = rest.startsWith("x ");
  if (completed !== task.completed) return fail();
  if (completed) rest = rest.slice(2).trimStart();
  const match = rest.match(/^\([A-Z]\)(?=\s|$)/);
  const prefix = match?.[0] ?? null;
  if (prefix) rest = rest.slice(prefix.length).trimStart();
  const takeDate = () => {
    const token = rest.split(/\s/)[0];
    if (!isTaskDate(token)) return null;
    rest = rest.slice(token.length).trimStart();
    return token;
  };
  const completion = completed ? takeDate() : null;
  const creation = !completed || completion ? takeDate() : null;
  if (completion !== task.completion_date || creation !== task.creation_date || rest !== task.description) return fail();
  return prefix;
}

// Updates replace whole task lines, retaining hidden legacy data and lifecycle metadata.
export function composeEditedTask(task: EditableTask, fields: Omit<ComposeFields, "contexts">, editDate: string): string {
  validateDescription(fields.description);
  if (!isTaskDate(editDate)) throw new Error("Invalid task edit date");
  if (task.completed && task.creation_date && !task.completion_date) {
    throw new Error("Cannot preserve creation date on a completed task without a completion date");
  }
  const prefix = legacyPrefix(task);
  const descriptionTokens = fields.description.split(/\s+/).filter((token) => token &&
    !token.startsWith("updated:") && !token.startsWith("due:"));
  if (!descriptionTokens.length && !task.contexts.length) return "";

  const submittedKeys = new Set(descriptionTokens.map(tagEntry).filter((entry) => entry !== null).map(([key]) => key));
  const projects = fields.project === (task.projects[0] ?? "")
    ? task.projects
    : fields.project ? [fields.project] : [];
  const labels = new Set([...projects.map((p) => `+${p}`), ...task.contexts.map((c) => `@${c}`)]);
  const seenLabels = new Set<string>();
  const body = descriptionTokens.filter((token) => {
    if (!labels.has(token)) return true;
    if (seenLabels.has(token)) return false;
    seenLabels.add(token);
    return true;
  });
  for (const token of labels) if (!seenLabels.has(token)) body.push(token);
  if (fields.due) body.push(`due:${fields.due}`);
  for (const [key, value] of Object.entries(task.tags)) {
    if (!["due", "updated", "pri"].includes(key) && !submittedKeys.has(key)) body.push(`${key}:${value}`);
  }
  body.push(`updated:${editDate}`);

  const parts: string[] = [];
  if (task.completed) parts.push("x");
  if (prefix) parts.push(prefix);
  if (task.completed && task.completion_date) {
    parts.push(task.completion_date);
    if (task.creation_date) parts.push(task.creation_date);
  } else if (!task.completed && task.creation_date) {
    parts.push(task.creation_date);
  }
  parts.push(body.join(" "));
  return parts.join(" ");
}

// Match the backend's nonempty, case-sensitive, first-colon tag contract.
function tagEntry(token: string): [string, string] | null {
  if (token.startsWith("+") || token.startsWith("@")) return null;
  const colon = token.indexOf(":");
  return colon > 0 && colon < token.length - 1 ? [token.slice(0, colon), token.slice(colon + 1)] : null;
}

// Whole-token matching keeps email addresses, URLs, and similarly named labels intact.
function stripTokens(description: string, tokens: string[]): string {
  const hidden = new Set(tokens);
  return description.split(/\s+/).filter((token) => !hidden.has(token)).join(" ").trim();
}

export function hideContexts(description: string, contexts: string[]): string {
  return stripTokens(description, contexts.map((context) => `@${context}`));
}

export function listDescription(description: string, projects: string[], contexts: string[], displayedDates: TaskDateMetadata): string {
  const dateTokens = description.split(/\s+/).filter((token) => {
    const entry = tagEntry(token);
    return entry !== null && (entry[0] === "due" || entry[0] === "updated") &&
      displayedDates[entry[0]] !== undefined && isTaskDate(entry[1]);
  });
  return stripTokens(description, [...projects.map((p) => `+${p}`), ...contexts.map((c) => `@${c}`), ...dateTokens]);
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
  return stripTokens(description, [
    ...projects.map((p) => `+${p}`),
    ...contexts.map((c) => `@${c}`),
    ...Object.entries(tags).filter(([k]) => k !== "pri").map(([k, v]) => `${k}:${v}`),
  ]);
}

// Validate a label name typed in the modal. Returns { name } on success or { error } on
// rejection. Strips leading +/@ sigils a user may type, then forbids whitespace and any +/@/:
// in the bare name (a key:value name would compose into a tag, not a label).
export function parseLabelInput(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/^[+@]+/, "");
  if (!name) return { error: "Name is required." };
  if (/\s/.test(name)) return { error: "No spaces allowed in a project." };
  if (/[+@:]/.test(name)) return { error: "A project cannot contain + @ or :" };
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
