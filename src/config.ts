// Shared configuration tables, ported from web/app.js. Each is the single source of truth for
// its concern (label kinds, status/sort options, the add-form sentinels, timings, view order),
// so wording and behaviour never drift between components.

import type { Task } from "./api";

// Everything that differs between the two label kinds lives here, so the prefix and
// user-facing word are defined once instead of scattered across the markup and the
// compose/populate logic.
export const KINDS = {
  project: { prefix: "+", singular: "project" },
  context: { prefix: "@", singular: "context" },
} as const;

export type Kind = keyof typeof KINDS;
export const KIND_LIST: Kind[] = ["project", "context"];

// The "add" entry value pinned at the top of each label select. It is recognised by a flag,
// never by this value, so a real label can never be mistaken for it; the value is a
// validator-forbidden token (`+`) as defence-in-depth.
export const ADD_VALUE = "+add";

// Visible text of the empty / no-selection option shared by the add-form dropdowns. value=""
// is the real no-selection state; this is only its label, kept in one place.
export const EMPTY_LABEL = "None";

// Priority letters offered by the add/edit pickers. A–C covers the common cases; tasks with
// higher priorities set via raw todo.txt are preserved and displayed but not offered as picker options.
export const PRIORITIES = ["A", "B", "C"] as const;

// The Priority picker's options, with the no-selection "None" first. Defined once here so the
// add form and the edit modal offer the identical list instead of each rebuilding it (DRY).
export const PRIORITY_OPTIONS = [
  { value: "", label: EMPTY_LABEL },
  ...PRIORITIES.map((p) => ({ value: p as string, label: p as string })),
];

// How long after the last keystroke the note auto-saves. One named source, not a magic number.
export const NOTE_SAVE_DELAY_MS = 800;

// Status filter options keyed by their <select> value. `completed` is the query param the
// option maps to (null = omit it), kept beside the label so the query builder never re-decides
// what a status means.
export const STATUSES = {
  all: { label: "All", completed: null as boolean | null },
  active: { label: "Active", completed: false as boolean | null },
  completed: { label: "Completed", completed: true as boolean | null },
} as const;

export type Status = keyof typeof STATUSES;

// Compare two optional sort keys ascending, with absent values (null/undefined) always ordering
// after present ones — so "no priority" / "no due date" sink to the bottom. ISO date strings and
// single-char priorities compare correctly with <, so no parsing is needed.
export function cmpMissingLast(a: string | null | undefined, b: string | null | undefined): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

// The alphabetically-first label of a task, or null when it has none — so tasks with no
// project/context sort to the bottom like any other missing key. Reduces to the min rather
// than sorting a copy: no allocation, no full sort, and the task's own label array is never
// mutated.
function firstLabel(labels: string[]): string | null {
  return labels.length ? labels.reduce((m, x) => (x < m ? x : m)) : null;
}

// Client-side sort orders. compare:null keeps the server's file order. Every comparator sorts
// ascending and sends tasks missing the key to the bottom; JS's stable sort keeps file order
// among ties. The label sorts (projects/contexts) key off the task's alphabetically-first label.
export const SORTS: Record<string, { label: string; compare: ((a: Task, b: Task) => number) | null }> = {
  file: { label: "File order", compare: null },
  priority: { label: "Priority", compare: (a, b) => cmpMissingLast(a.priority, b.priority) },
  due: { label: "Due date", compare: (a, b) => cmpMissingLast(a.tags.due, b.tags.due) },
  created: { label: "Created", compare: (a, b) => cmpMissingLast(a.creation_date, b.creation_date) },
  projects: { label: "Projects", compare: (a, b) => cmpMissingLast(firstLabel(a.projects), firstLabel(b.projects)) },
  contexts: { label: "Contexts", compare: (a, b) => cmpMissingLast(firstLabel(a.contexts), firstLabel(b.contexts)) },
};

// Sort direction. asc is each comparator's natural (ascending) order; desc reverses the
// comparator. Keyed by <select> value, label beside it — mirrors STATUSES so the text lives once.
export const DIRECTIONS = {
  asc: { label: "ASC" },
  desc: { label: "DESC" },
} as const;

export type Direction = keyof typeof DIRECTIONS;

// THE VIEW ORDER — one home. The nav-button order, the swipe direction, and the default view
// all derive from this one array (mirrors web/app.js VIEWS).
export const VIEWS = ["note", "todo"] as const;
export type View = (typeof VIEWS)[number];

// px of horizontal travel before a drag counts as a view swipe.
export const SWIPE_MIN = 50;

// Return the tasks in the order selected by the Sort + Direction pickers. file order (compare
// null) is a no-op in asc (the backend already returns file order) and its reverse in desc; other
// keys sort a copy so the fetched array is never mutated. desc negates the comparator, so it is
// the exact reverse of asc — including sinking missing-key tasks to the top — one rule, no special
// case. Stable sort keeps file order among ties in both directions.
export function sortTasks(tasks: Task[], sort: string, dir: Direction = "asc"): Task[] {
  const compare = SORTS[sort].compare;
  if (!compare) return dir === "asc" ? tasks : [...tasks].reverse();
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => sign * compare(a, b));
}
