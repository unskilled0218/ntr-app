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

// The "remove" entry value appended to a filter select when a concrete label is selected, so
// removal lives inside the dropdown instead of a separate button. Recognised by exact value;
// a real label can never collide because label names forbid whitespace (parseLabelInput) and
// this value contains one.
export const REMOVE_VALUE = "remove label";

// Visible text of the empty / no-selection option shared by the add-form dropdowns. value=""
// is the real no-selection state; this is only its label, kept in one place.
export const EMPTY_LABEL = "None";

// Priority letters offered by the add/edit pickers. A–C covers the common cases; tasks with
// higher priorities set via raw todo.txt are preserved and displayed but not offered as picker options.
export const PRIORITIES = ["A", "B", "C"] as const;

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

// Client-side sort orders. compare:null keeps the server's file order. Every comparator sorts
// ascending and sends tasks missing the key to the bottom; JS's stable sort keeps file order
// among ties.
export const SORTS: Record<string, { label: string; compare: ((a: Task, b: Task) => number) | null }> = {
  file: { label: "File order", compare: null },
  priority: { label: "Priority", compare: (a, b) => cmpMissingLast(a.priority, b.priority) },
  due: { label: "Due date", compare: (a, b) => cmpMissingLast(a.tags.due, b.tags.due) },
  created: { label: "Created", compare: (a, b) => cmpMissingLast(a.creation_date, b.creation_date) },
  alpha: {
    label: "A-Z",
    compare: (a, b) => a.description.localeCompare(b.description, undefined, { sensitivity: "base" }),
  },
};

// THE VIEW ORDER — one home. The nav-button order, the swipe direction, and the default view
// all derive from this one array (mirrors web/app.js VIEWS).
export const VIEWS = ["note", "todo"] as const;
export type View = (typeof VIEWS)[number];

// px of horizontal travel before a drag counts as a view swipe.
export const SWIPE_MIN = 50;

// Return the tasks in the order selected by the Sort dropdown. file order is a no-op (the
// backend already returns file order); other keys sort a copy so the fetched array is never
// mutated.
export function sortTasks(tasks: Task[], sort: string): Task[] {
  const compare = SORTS[sort].compare;
  return compare ? [...tasks].sort(compare) : tasks;
}
