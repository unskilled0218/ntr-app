# 24 - Persist the todo view options to the local cache

## Goal

Remember the user's todo **view options** across app launches by saving them to the
local cache (`localStorage`), never to the server. Three options, exactly as listed:

- **Status** (the All / Active / Completed filter)
- **Sort** (the sort key)
- **Direction** (ASC / DESC)

Today these are plain `useState` in `TodoPane` that reset to their defaults on every
mount (`src/components/TodoPane.tsx:35,38,39`): `status = "all"`, `sort = "file"`,
`dir = "asc"`. Task 16 explicitly deferred this ("No persistence of the chosen
sort/direction across launches ... a separate concern from this task"); this is that
concern.

The **project / context label filters are deliberately NOT persisted** (see Out of
scope): they name labels that only exist while a task carries them, and `loadLabels`
already drops a selection whose label has vanished (`TodoPane.tsx:83-84`). Persisting
them would resurrect filters pointing at labels that may no longer exist. Status / sort
/ direction have no such dependency — their valid values are fixed config tables — so
they are the safe, meaningful things to remember.

## The single idea: view options are client-local preferences, so they live where the other preferences live

`status` / `sort` / `dir` describe **how this client is looking at the list**, not data
about the tasks — the same category as `serverUrl`, `compactUi`, `conflictStrategy`,
`allowInvalidCert`. Those already have one home: `src/settings.ts`, the module that owns
every `localStorage`-backed preference behind `getX` / `setX` pairs. So the new
persistence belongs there too, in the identical shape, and **not** scattered into
`TodoPane` as ad-hoc `localStorage` calls. `TodoPane` keeps owning the *runtime* state;
`settings.ts` owns *how it is stored*.

"not server" falls out for free: `settings.ts` writes only to `localStorage`, and the
options never enter `api.ts`'s request building (which reads `status` as a query arg but
never sends sort/direction at all — sorting is client-side, `config.ts:99-109`). The
options stay local even in server mode, which is correct: they are per-device view
state, not shared task data.

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| `localStorage` keys + get/set for the 3 options | `src/settings.ts` | **Add** three get/set pairs |
| Valid values for each option (the source of truth) | `STATUSES` / `SORTS` / `DIRECTIONS` in `src/config.ts` | Reused for read-time validation — no new list |
| Runtime view state + change handlers | `src/components/TodoPane.tsx` | Init from the getters; persist in the change handlers |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.12.0 -> 0.13.0 (done) |

No backend (`src-tauri/`), `api.ts`, `config.ts`, or `FilterBar` change.

## `src/settings.ts` — three get/set pairs (new)

Add, following the file's existing idiom exactly (the `getConflictStrategy` pair is the
template: validate on read, represent the default by the **absence** of the key):

```ts
import { DIRECTIONS, SORTS, STATUSES, type Direction, type Status } from "./config";

const STATUS_KEY = "ntr.status";
const SORT_KEY = "ntr.sort";
const SORT_DIR_KEY = "ntr.sortDir";

// The todo view options — status filter, sort key, sort direction — persisted to the local cache
// only (never sent to the server): they describe how THIS client views the list, not the tasks
// themselves. Each is validated against its config table on read, so a stored value that no longer
// exists (e.g. a sort key dropped in a later version, as `alpha` was in task 16) degrades to the
// default instead of throwing in sortTasks. The default is the absence of the key, exactly as
// setServerUrl / setConflictStrategy represent theirs.

export function getStatus(): Status {
  const v = localStorage.getItem(STATUS_KEY);
  return v && v in STATUSES ? (v as Status) : "all";
}

export function setStatus(s: Status): void {
  s === "all" ? localStorage.removeItem(STATUS_KEY) : localStorage.setItem(STATUS_KEY, s);
}

export function getSort(): string {
  const v = localStorage.getItem(SORT_KEY);
  return v && v in SORTS ? v : "file";
}

export function setSort(s: string): void {
  s === "file" ? localStorage.removeItem(SORT_KEY) : localStorage.setItem(SORT_KEY, s);
}

export function getDirection(): Direction {
  const v = localStorage.getItem(SORT_DIR_KEY);
  return v && v in DIRECTIONS ? (v as Direction) : "asc";
}

export function setDirection(d: Direction): void {
  d === "asc" ? localStorage.removeItem(SORT_DIR_KEY) : localStorage.setItem(SORT_DIR_KEY, d);
}
```

### Why validate against the config tables (`v in STATUSES`) rather than re-listing values

`getConflictStrategy` hardcodes its valid set (`v === "server" || v === "local"`) because
that set is defined in `settings.ts` itself (the `ConflictStrategy` type). For status /
sort / direction the valid set already lives in `config.ts` as `STATUSES` / `SORTS` /
`DIRECTIONS`. Re-typing the keys here would be Knowledge Duplication (one decision, two
homes that must change together). Using `v in TABLE` makes the table the single source of
truth, so when a sort key is added or removed in `config.ts`, persistence follows with no
edit here. This is exactly why the validation reads the table instead of a literal list.

### Accepted trade-off: each default literal lives in both the getter and the setter

For each option the default value appears twice — the getter's fallback (`?? "all"`) and the
setter's "this is the default, so remove the key" check (`s === "all"`). This is a deliberate,
documented duplication: it mirrors the file's established `getConflictStrategy` /
`setConflictStrategy` idiom exactly. Extracting per-option `DEFAULT_*` constants to DRY it up
would diverge from that idiom and cost conceptual integrity for a one-token literal, so the
symmetry is kept on purpose (brooks-review round 1, R3 — accepted, not actioned).

### Why this import direction is safe (no cycle)

`settings.ts` will import **values** (`STATUSES` / `SORTS` / `DIRECTIONS`) and **types**
from `config.ts`. `config.ts` imports only `import type { Task }` from `api.ts` — a
type-only import, erased at compile time, so `config.ts` has no runtime dependency on
anything. `api.ts` imports `settings.ts` at runtime. The runtime edges are therefore
`api -> settings -> config`, a chain with no back-edge — no import cycle is introduced.

## `src/components/TodoPane.tsx` — init from cache, persist on change

Two surgical changes; no new state, no effects.

1. **Import the persistence pairs** (aliased so they do not collide with the local
   `useState` setters `setStatus` / `setSort`):

   ```ts
   import {
     getStatus,
     setStatus as persistStatus,
     getSort,
     setSort as persistSort,
     getDirection,
     setDirection as persistDir,
   } from "../settings";
   ```

2. **Seed the three states from the cache** via `useState`'s lazy initializer (the
   function form runs once on mount, reading `localStorage` a single time):

   ```ts
   const [status, setStatus] = useState<Status>(getStatus);
   const [sort, setSort] = useState(getSort);
   const [dir, setDir] = useState<Direction>(getDirection);
   ```

   (`getStatus` / `getDirection` already return the precise `Status` / `Direction` type,
   so the explicit type args are kept only for documentation parity with today's code.)

3. **Persist inside the change handlers** passed to `FilterBar` — persistence is the
   user's change *event*, so it belongs in the handler, not a `useEffect` (writing in an
   effect would also re-write on mount for no reason):

   ```tsx
   onStatus={(s) => { setStatus(s); persistStatus(s); }}
   onSort={(s) => { setSort(s); persistSort(s); }}
   onDir={(d) => { const next = d as Direction; setDir(next); persistDir(next); }}
   ```

   The `onDir` handler computes `next` once so the `as Direction` cast (FilterBar hands
   back a `string`) and both calls share one value — same cast that exists today
   (`TodoPane.tsx:192`), just reused.

`status` continues to feed `refresh`'s dependency list (a status change still refetches,
`TodoPane.tsx:60`); `sort` / `dir` remain render-only and do not refetch. Persistence
adds a `localStorage` write beside each existing `setState` and changes nothing else
about the data flow.

### Why not a `usePersistentState` hook

A generic hook wrapping `useState` + write-through would fold the three wirings into one
abstraction, but it would also have to thread the per-key getter/setter, the `Direction`
cast, and functional-update support for a grand total of three call sites in one file —
machinery that hides the one fact a reader wants (these three values are cached). Three
explicit two-statement handlers state that fact directly. The reused part — *how* a value
is stored and validated — is already extracted, into `settings.ts`. This keeps the
abstraction at the storage layer (deep, reused by tests too) and the wiring honest and
local.

## Tests

1. **`src/settings.test.ts`** (extend; it already covers the other pairs with real jsdom
   `localStorage` and an `afterEach(() => localStorage.clear())`). Add a `describe` per
   pair asserting the behaviour each get/set encodes:
   - **default when absent** — `getStatus()` is `"all"`, `getSort()` is `"file"`,
     `getDirection()` is `"asc"` with no key set.
   - **round-trips a valid non-default** — `setSort("priority")` then `getSort()` is
     `"priority"` (and the raw key holds `"priority"`); same for `setStatus("active")`,
     `setDirection("desc")`.
   - **invalid stored value falls back to the default** — write a bogus value straight to
     the key (`localStorage.setItem("ntr.sort", "alpha")`) and assert `getSort()` is
     `"file"`. This locks in the table-validation contract (the task-16 `alpha` removal
     scenario). Same for a bogus status / direction.
   - **default removes the key** — `setStatus("active")` then `setStatus("all")` leaves
     `localStorage.getItem("ntr.status")` `null` and `getStatus()` `"all"`; same for the
     other two defaults.

2. **`src/components/TodoPane.test.tsx`** (extend; mocks `../api`, real `localStorage`).
   Add an `afterEach(() => localStorage.clear())` (the suite does not currently touch
   `localStorage`, so add the clear to keep cases isolated) and two cases that pin the
   wiring this task introduces:
   - **persists a pick** — open the Status picker, choose Active, and assert
     `localStorage.getItem("ntr.status") === "active"` (the handler wrote through). Reuse
     the existing picker-interaction helpers/pattern already in the suite (`openPicker` /
     dialog query) rather than new scaffolding.
   - **restores on mount** — with `ntr.sortDir` preset to `"desc"` (and a sort key whose
     order is observable) before `render`, assert the list mounts in the persisted order
     (or, if asserting DOM order is brittle against the fixture, that the Sort modal shows
     DESC selected). Prefer the order assertion if the fixture makes it unambiguous;
     otherwise the selected-state assertion. This proves the lazy `useState(getDirection)`
     seed is read.

   These two cases exercise the only new behaviour (write-through, read-on-mount) without
   re-testing `settings.ts`'s validation, which case (1) owns.

3. **No `FilterBar` test change.** `FilterBar` is untouched — it still receives `status` /
   `sort` / `dir` props and reports picks through the same callbacks; its existing tests
   (which pass literal props and assert the callbacks fire) stay valid as-is.

## Verification

- `npm test` — existing suites stay green; the new `settings` and `TodoPane` cases pass.
- `npm run build` (tsc + vite) — type-checks the new `settings.ts` exports (the
  `Status` / `Direction` returns, the `config` value import) and the `TodoPane` wiring;
  bundles at ntr@0.13.0.
- Manual, local mode: set Status = Active, Sort = Priority, Direction = DESC; reload the
  app (or restart) — the list comes back filtered to Active and sorted Priority/DESC, and
  the pickers show those selections. Switch every option back to its default and reload —
  defaults are restored and the `ntr.status` / `ntr.sort` / `ntr.sortDir` keys are absent
  in `localStorage` (default = absence).
- Manual, server mode: the same options persist locally and are **not** sent to the
  server (the list request still carries only the status query arg, exactly as before;
  sort/direction never hit the wire).

## Out of scope

- **Project / context label filters are not persisted** (rationale in Goal: they depend
  on labels that can vanish, and `loadLabels` already drops a stale selection). Only the
  three listed options are remembered.
- **No server-side storage / sync of view options.** Local cache only, per device — that
  is the point of the task ("not server").
- **No new config tables or option values.** The Status / Sort / Direction option sets
  are exactly task 16's; this task only persists the *current selection*.
- **No `compactUi` change.** It is already persisted (`getCompactUi`); it is not one of
  the three options in scope and is untouched.
- **No migration / versioning of the cache keys.** A future value removed from a table is
  handled at read time by the table-validation fallback, which is sufficient; no
  schema-version key is added.
