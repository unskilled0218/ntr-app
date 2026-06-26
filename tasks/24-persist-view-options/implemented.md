# Implemented — 24-persist-view-options

Persist the three todo view options to the local cache (`localStorage`), never the server.

## Changes

- **`src/settings.ts`** — added three get/set pairs following the existing
  `getConflictStrategy` idiom (validate on read against the config table; default = absence
  of the key):
  - `getStatus` / `setStatus` (key `ntr.status`, default `all`, validated against `STATUSES`)
  - `getSort` / `setSort` (key `ntr.sort`, default `file`, validated against `SORTS`)
  - `getDirection` / `setDirection` (key `ntr.sortDir`, default `asc`, validated against `DIRECTIONS`)
  - New import: `STATUSES` / `SORTS` / `DIRECTIONS` + `Status` / `Direction` types from `./config`.
    Runtime chain stays `api -> settings -> config` (config -> api is type-only) — no cycle.

- **`src/components/TodoPane.tsx`** — seed the three states from the cache via `useState`'s
  lazy initializer (`useState(getStatus)` etc.), and persist in the `FilterBar` change
  handlers (`onStatus={(s) => { setStatus(s); persistStatus(s); }}`, same for sort/dir). The
  settings setters are import-aliased (`persistStatus` / `persistSort` / `persistDir`) to avoid
  colliding with the local `useState` setters. No new state, no effects.

- **Version** — 0.12.0 -> 0.13.0 in package.json, tauri.conf.json, Cargo.toml, Cargo.lock.

## Not changed

- Project / context label filters are **not** persisted (they depend on labels that can vanish;
  `loadLabels` already drops a stale selection).
- No backend / `api.ts` / `config.ts` / `FilterBar` change. Options never hit the wire.

## Tests

- `src/settings.test.ts` — 3 new describe blocks (12 cases): default-when-absent, valid
  round-trip, invalid-stored-value-falls-back-to-default (incl. the removed `alpha` sort key),
  and default-removes-the-key, for each of status / sort / direction.
- `src/components/TodoPane.test.tsx` — 2 new cases: a Status pick writes through to
  `ntr.status`; a preset `ntr.status=active` drives the mount fetch's filter (`completed: false`),
  proving the seed is read on mount. Added `localStorage.clear()` to `afterEach`.

## Verification

- `npm run build` — type-checks and bundles at ntr@0.13.0.
- `npm test` — 167 tests pass (21 files).
