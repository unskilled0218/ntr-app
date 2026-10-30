import type { Task } from "../api";
import type { Offer } from "./remoteUpdates";

export const DIFF_WORK_BUDGET = 40_000;
export const DIFF_INPUT_CHARACTERS = 50_000;
export const PREVIEW_CHARACTERS = 8_000;
export const PREVIEW_ROWS = 80;
export interface DiffSection { kind: "added" | "removed" | "context" | "meta"; text: string; label?: string }
export interface DiffDocument { sections: DiffSection[]; fallback?: boolean }
export interface Cursor { section: number; offset: number }
export const START: Cursor = { section: 0, offset: 0 };

function noteDiff(before: string, after: string): DiffDocument {
  const fallback = (): DiffSection[] => [{ kind: "removed", text: before }, { kind: "added", text: after }];
  let sections: DiffSection[];
  let bounded = before.length + after.length > DIFF_INPUT_CHARACTERS;
  if (bounded) sections = fallback();
  else {
    const left = before ? before.split("\n") : [], right = after ? after.split("\n") : [];
    let prefix = 0, suffix = 0;
    while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
    while (suffix < left.length - prefix && suffix < right.length - prefix && left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
    const a = left.slice(prefix, left.length - suffix), b = right.slice(prefix, right.length - suffix);
    bounded = (a.length + 1) * (b.length + 1) > DIFF_WORK_BUDGET;
    if (bounded) sections = fallback();
    else {
      const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
      for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
        rows[i][j] = a[i] === b[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
      }
      sections = left.slice(0, prefix).map((text) => ({ kind: "context", text: text + "\n" }));
      let i = 0, j = 0;
      while (i < a.length || j < b.length) {
        if (i < a.length && j < b.length && a[i] === b[j]) { sections.push({ kind: "context", text: a[i++] + "\n" }); j++; }
        else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) sections.push({ kind: "removed", text: a[i++] + "\n" });
        else sections.push({ kind: "added", text: b[j++] + "\n" });
      }
      sections.push(...left.slice(left.length - suffix).map((text): DiffSection => ({ kind: "context", text: text + "\n" })));
    }
  }
  if (!bounded) {
    const compact: DiffSection[] = [];
    for (let start = 0; start < sections.length;) {
      if (sections[start].kind !== "context") { compact.push(sections[start++]); continue; }
      let end = start;
      while (end < sections.length && sections[end].kind === "context") end++;
      if (end - start > 6) {
        compact.push(...sections.slice(start, start + 3), { kind: "meta", text: `@@ … ${end - start - 6} … @@\n`, label: `${end - start - 6} unchanged lines omitted` }, ...sections.slice(end - 3, end));
      } else compact.push(...sections.slice(start, end));
      start = end;
    }
    sections = compact;
  }
  if (before.endsWith("\n") !== after.endsWith("\n")) sections.push({
    kind: "meta", text: `@@ EOF − ${before.endsWith("\n") ? "LF" : "none"} / + ${after.endsWith("\n") ? "LF" : "none"} @@\n`,
    label: `Trailing newline: accepted ${before.endsWith("\n") ? "yes" : "no"}; incoming ${after.endsWith("\n") ? "yes" : "no"}`,
  });
  return { sections, fallback: bounded };
}
function taskIdentity(task: Task) { return JSON.stringify([task.raw, task.completed, task.completion_date, task.creation_date]); }
function taskText(task: Task) {
  return `Task #${task.id} (${task.completed ? "completed" : "active"}; created ${task.creation_date ?? "none"}; completed ${task.completion_date ?? "none"})\n${task.raw}\n`;
}
export function remoteDiff(offer: Offer): DiffDocument {
  if (offer.resource === "note") return noteDiff(offer.baseline as string, offer.snapshot as string);
  const before = offer.baseline as Task[], after = offer.snapshot as Task[];
  const old = new Map(before.map((task) => [task.id, task])), next = new Map(after.map((task) => [task.id, task]));
  const sections: DiffSection[] = [];
  for (const task of before) if (!next.has(task.id) || taskIdentity(task) !== taskIdentity(next.get(task.id)!)) sections.push({ kind: "removed", text: taskText(task) });
  for (const task of after) if (!old.has(task.id) || taskIdentity(task) !== taskIdentity(old.get(task.id)!)) sections.push({ kind: "added", text: taskText(task) });
  return { sections };
}
export function fullEvidence(offer: Offer, side: "accepted" | "incoming"): DiffSection[] {
  const snapshot = side === "accepted" ? offer.baseline : offer.snapshot;
  return offer.resource === "note" ? [{ kind: "context", text: snapshot as string }]
    : (snapshot as Task[]).map((task) => ({ kind: "context", text: taskText(task) }));
}
// A cursor pages through original sections without expanding a huge line into DOM nodes.
// Every view (including fallback blocks) uses the same character and line budgets.
export function previewPage(sections: DiffSection[], cursor: Cursor) {
  const fragments: DiffSection[] = [];
  let { section, offset } = cursor;
  let characters = 0, rows = 0;
  while (section < sections.length && characters < PREVIEW_CHARACTERS && rows < PREVIEW_ROWS) {
    const entry = sections[section];
    const limit = Math.min(entry.text.length, offset + PREVIEW_CHARACTERS - characters);
    let end = offset;
    while (end < limit && rows < PREVIEW_ROWS) { if (entry.text[end] === "\n") rows++; end++; }
    if (end > offset) { fragments.push({ ...entry, text: entry.text.slice(offset, end) }); characters += end - offset; }
    if (end === entry.text.length) { section++; offset = 0; }
    else { offset = end; break; }
  }
  const remaining = sections.slice(section).reduce((count, entry) => count + entry.text.length, 0) - offset;
  return { fragments, characters, rows, remaining, next: section < sections.length ? { section, offset } : null };
}
