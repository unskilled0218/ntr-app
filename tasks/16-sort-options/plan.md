# 16 - Update sort options

## Goal

Change the Sort chooser so it offers, in this order:

- File order
- Priority
- Due date
- Created
- **Projects** (new)
- **Contexts** (new)

and add a separate **Direction** chooser with **ASC** / **DESC**, applied to
whichever sort is selected. The old **A-Z** sort is removed (it is subsumed by
the new Projects/Contexts label sorts plus the generic direction toggle; nothing
else depends on description-text ordering).

Today the sort list lives in `SORTS` (`src/config.ts:65-74`) and is applied by
`sortTasks(tasks, sort)` (`src/config.ts:87-90`); there is no direction concept —
every comparator is ascending only. The Sort `<SelectField>` is rendered in
`FilterBar` (`src/components/FilterBar.tsx`), and the `sort` state lives in
`TodoPane` (`src/components/TodoPane.tsx:34`, applied at `:168`).

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| Sort option table (key → label + comparator) | `SORTS` in `src/config.ts` | Drop `alpha`; add `projects`, `contexts` |
| Direction option table (key → label) | new `DIRECTIONS` in `src/config.ts` | Add `{ asc, desc }` |
| "alphabetically-first label" helper | new `firstLabel()` in `src/config.ts` | Add (drives both label comparators) |
| Apply sort + direction | `sortTasks()` in `src/config.ts` | Add a `dir` parameter |
| Sort/Direction state | `TodoPane` (`src/components/TodoPane.tsx`) | Add `dir` state next to `sort` |
| Sort + Direction pickers (UI) | `FilterBar` (`src/components/FilterBar.tsx`) | Add a Direction `<SelectField>` |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.4.1 -> 0.5.0 (done) |

No backend (`src-tauri/`) or `api.ts` change: sorting is entirely client-side
(the comment at `config.ts:84` already records this), and `projects` / `contexts`
already exist on `Task` (`src/api.ts:19-20`).

## Config changes (`src/config.ts`)

### 1. New label comparators — sort by the first label

`projects` and `contexts` are `string[]` (`src/api.ts:19-20`) and a task may have
zero, one, or many of each. To get a single, stable ordering key we sort by the
task's **alphabetically-first** label, with tasks that have none sinking to the
bottom — exactly the "missing last" rule the existing comparators already use via
`cmpMissingLast` (`config.ts:55-60`). One helper expresses this once:

```ts
// The alphabetically-first label of a task, or null when it has none — so tasks
// with no project/context sort to the bottom like any other missing key. Reduces
// to the min rather than sorting a copy: no allocation, no full sort, and the
// task's own label array is never mutated.
function firstLabel(labels: string[]): string | null {
  return labels.length ? labels.reduce((m, x) => (x < m ? x : m)) : null;
}
```

The two new `SORTS` entries reuse `cmpMissingLast` so label sorts behave
identically to the priority/due/created sorts (case-sensitive `<` on the raw
label string, which matches how labels are stored):

```ts
projects: {
  label: "Projects",
  compare: (a, b) => cmpMissingLast(firstLabel(a.projects), firstLabel(b.projects)),
},
contexts: {
  label: "Contexts",
  compare: (a, b) => cmpMissingLast(firstLabel(a.contexts), firstLabel(b.contexts)),
},
```

`alpha` is deleted. The resulting `SORTS` insertion order is
`file, priority, due, created, projects, contexts`, which is exactly the order
the Sort picker must show (the picker maps `Object.entries(SORTS)` in order, see
FilterBar below), so the table order is the single source of truth for the menu
order.

### 2. Direction table + type

A small table mirrors `STATUSES` so the label text lives in one place and the
picker derives its options from it:

```ts
// Sort direction. asc is each comparator's natural (ascending) order; desc
// reverses the comparator. Keyed by <select> value, label beside it.
export const DIRECTIONS = {
  asc: { label: "ASC" },
  desc: { label: "DESC" },
} as const;

export type Direction = keyof typeof DIRECTIONS;
```

### 3. `sortTasks` gains a direction

```ts
export function sortTasks(tasks: Task[], sort: string, dir: Direction = "asc"): Task[] {
  const compare = SORTS[sort].compare;
  // File order (compare === null): asc is the backend's order untouched; desc is
  // that order reversed. We copy before reversing so the fetched array is never
  // mutated (same contract as the sort branch).
  if (!compare) return dir === "asc" ? tasks : [...tasks].reverse();
  const sign = dir === "asc" ? 1 : -1;
  return [...tasks].sort((a, b) => sign * compare(a, b));
}
```

`dir` defaults to `"asc"` so the signature stays backward-compatible and every
existing `sortTasks(tasks, sort)` call (and its tests) keeps its current meaning.

#### Direction semantics — deliberate, documented

`desc` multiplies the comparator by `-1`. Two consequences, both intended and
both noted in the code comment:

- **Ties keep file order in both directions.** Equal elements (`compare` returns
  `0`) are untouched by the sign flip, and `Array.prototype.sort` is stable, so
  same-priority (etc.) tasks stay in file order whether asc or desc. This is the
  same tie behaviour the current code already relies on.
- **`desc` puts missing-key tasks first.** Because the whole comparator is
  negated, the "missing last" of `cmpMissingLast` becomes "missing first" under
  `desc`. This is the single, predictable rule "desc is the exact reverse of
  asc" (conceptual integrity: one rule, no special case), and it is the simplest
  thing a user reading "DESC" expects — a literal reversal. We deliberately do
  **not** add a "keep missing last in both directions" special case: it would
  split one rule into two and surprise anyone who expects desc to mirror asc.
  For `file` order there is no missing key, so this consequence does not apply.

## UI changes (`src/components/FilterBar.tsx`)

`SORT_OPTIONS` already derives from `SORTS` order, so removing `alpha` and adding
`projects`/`contexts` needs no FilterBar change for the Sort picker itself.

Add a Direction picker beside Sort, built the same way as the others (a
`<SelectField>` modal trigger, consistent with task 14's "every chooser is a
modal picker"):

- Import `DIRECTIONS` (and keep existing imports).
- Derive its options once at module scope, mirroring `STATUS_OPTIONS`:

  ```ts
  const DIRECTION_OPTIONS: FieldOption[] = Object.entries(DIRECTIONS).map(([value, d]) => ({
    value,
    label: d.label,
  }));
  ```

- Add `dir: string` and `onDir: (d: string) => void` to `Props`.
- Render a new `<label>Direction <SelectField ariaLabel="Sort direction" .../></label>`
  immediately after the Sort label, so the row reads Status / Project / Context /
  Sort / Direction.

## State wiring (`src/components/TodoPane.tsx`)

- Add `const [dir, setDir] = useState<Direction>("asc");` next to the `sort`
  state (`:34`), importing `type Direction` from `../config`.
- Pass `dir` into the render-time sort: `sortTasks(tasks, sort, dir)` (`:168`).
- Pass `dir={dir}` and `onDir={(d) => setDir(d as Direction)}` to `<FilterBar>`
  alongside the existing `sort`/`onSort` props.

`dir`, like `sort`, is render-only client state: it does **not** enter `refresh`'s
dependency list, so changing direction re-renders without refetching — matching
how `sort` already works (the `refresh` deps are `status, project, context` only,
`:55`).

## Tests

This feature is behaviour, so it gets tests (unlike task 15's styling-only
change). Three layers:

1. **`src/config.test.ts` (or a new `sortTasks` block there)** — the comparator
   logic, no DOM:
   - `projects` sort orders tasks by their first project, missing-project tasks
     last (asc); multi-project tasks key off the alphabetically-first label.
   - `contexts` sort, same shape.
   - `desc` reverses each comparator (assert the reverse of an asc result) and,
     for `file`, returns the reversed array.
   - `desc` on a comparator puts the missing-key tasks first (locks in the
     documented semantics so a later "fix" can't silently change it).
   - `sortTasks(tasks, sort)` with no `dir` arg still behaves as asc (default
     param regression).
   - `sortTasks` never mutates its input array (asc sort, desc sort, and file
     desc all return without reordering `tasks` in place).
   - Check `SORTS` no longer has `alpha` and has `projects` + `contexts` in the
     expected order.

   First confirm whether `src/config.test.ts` already covers `sortTasks`; extend
   it rather than duplicating setup. Reuse any existing task-factory helper in
   the test file instead of hand-building `Task` objects.

2. **`src/components/FilterBar.test.tsx`** — the Direction picker renders with the
   "Sort direction" aria-label, shows ASC/DESC, and calls `onDir` with the chosen
   value; the Sort picker now lists Projects/Contexts and no longer lists A-Z.
   Follow the existing FilterBar picker tests' interaction pattern.

3. **`src/components/TodoPane.test.tsx`** — if it asserts list order, add a case:
   choosing a sort + DESC re-renders the list in the reversed order without a
   refetch (assert the API list mock is not called again). Only add this if the
   suite already exercises sort/render order; otherwise the config-level tests
   cover the logic and this stays out of scope.

## Verification

- `npm test` — all suites pass (existing + new).
- `npm run build` (tsc + vite) — type-checks (the new `Direction` type, the
  widened `sortTasks` signature, the new `FilterBar` props) and bundles.
- Manual, local mode: the Sort picker shows File order / Priority / Due date /
  Created / Projects / Contexts (no A-Z); the new Direction picker shows ASC /
  DESC; picking Projects then DESC reorders the list live with no reload from the
  server; switching back to ASC restores the order.

## Out of scope

- **No backend / `api.ts` / `src-tauri` change** beyond the version bump. Sorting
  stays client-side.
- **No persistence** of the chosen sort/direction across launches — `sort` is not
  persisted today and `dir` follows suit (a separate concern from this task).
- **No multi-key / secondary sort.** One sort key + one direction, as specified.
- **No change to how labels are filtered** (the Project/Context *filter* pickers
  are untouched; this task only adds Project/Context as *sort* keys).
- **No re-introduction of A-Z.** Description-text sort is intentionally dropped.
