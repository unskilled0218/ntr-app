# 16 - Implemented

Implements the plan in `plan.md` (passed plan review at 99/100). Sort gains
Projects and Contexts keys, A-Z is dropped, and a new ASC/DESC Direction chooser
applies to whichever sort is selected.

## Changes

### `src/config.ts`
- Added `firstLabel(labels)` — the alphabetically-first label of a task (via
  `reduce` to the min, no array copy/sort), or `null` when it has none.
- `SORTS`: removed `alpha` (A-Z); added `projects` and `contexts`, each reusing
  `cmpMissingLast(firstLabel(...))` so they behave like the other key sorts
  (missing-key tasks last in asc). Insertion order is now
  `file, priority, due, created, projects, contexts` — the single source of the
  Sort menu order.
- Added `DIRECTIONS = { asc: { label: "ASC" }, desc: { label: "DESC" } }` and the
  `Direction` type, mirroring `STATUSES`.
- `sortTasks(tasks, sort, dir = "asc")`: `dir` defaults to `"asc"` (backward
  compatible). `file` order is the backend order in asc, reversed in desc; other
  keys negate the comparator under desc (`sign = -1`), so desc is the exact
  reverse of asc — including missing-key tasks moving to the top. Still copies
  before sorting/reversing, so the input array is never mutated.

### `src/components/FilterBar.tsx`
- New `dir` / `onDir` props and a `DIRECTION_OPTIONS` table derived from
  `DIRECTIONS`.
- Added a Direction `<SelectField ariaLabel="Sort direction">` after the Sort
  picker, so the row reads Status / Project / Context / Sort / Direction. Sort
  picker needed no change — it derives from `SORTS` order.

### `src/components/TodoPane.tsx`
- Added `const [dir, setDir] = useState<Direction>("asc")` beside `sort`.
- Render-time sort is now `sortTasks(tasks, sort, dir)`.
- Passes `dir` / `onDir` to `FilterBar`. `dir` is render-only state (not in
  `refresh`'s deps), so changing direction re-renders without refetching — same
  as `sort`.

### Tests
- `src/config.test.ts`: projects/contexts ordering (incl. multi-label keying off
  the first label and missing-last); desc reverses a comparator and puts
  missing-key first; desc on file order reverses; default direction == asc;
  no-mutation across asc/desc/file-desc; `SORTS` keys are exactly
  `[file, priority, due, created, projects, contexts]`.
- `src/components/FilterBar.test.tsx`: new `dir`/`onDir` in the render helper;
  Sort picker offers Projects/Contexts and no longer A-Z; Direction picker offers
  ASC/DESC and calls `onDir`.

### Version
- Bumped 0.4.1 -> 0.5.0 in `package.json`, `src-tauri/tauri.conf.json`,
  `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (new feature, minor bump).

## Verification
- `npm run build` (tsc + vite): type-checks and bundles clean.
- `npm test`: 17 files, 124 tests pass (the api.test.ts stderr is an intentional
  failure-path test, not a failure).

## Out of scope (unchanged from plan)
- No backend / `api.ts` / `src-tauri` change beyond the version bump.
- No persistence of sort/direction across launches.
- No multi-key/secondary sort. No A-Z re-introduction.
