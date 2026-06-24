# Implemented — 09 server/local conflict

Implements `plan.md` (which cleared brooks-review at 99/100).

## Changes

- **`src/lib/conflict.ts`** (new) — pure `classifyConflict(local, server)` →
  `"in-sync" | "adopt-server" | "conflict"`.
- **`src/settings.ts`** — `ConflictStrategy` (`"ask" | "server" | "local"`),
  `getConflictStrategy` (default `"ask"`, key-absent = default), `setConflictStrategy`.
- **`src/api.ts`**
  - Added `httpText` / `httpPutText` transport helpers; routed `getNote` /
    `putNote` through them.
  - Added `Conflict` / `ConflictResource` / `ConflictChoice` types, the
    `CONFLICT_IO` table, private `applyChoice`.
  - Renamed `syncFromServer` → `reconcileWithServer` (returns `Conflict[]`):
    auto-resolves in-sync / empty-local / non-ask strategies, returns the rest.
  - Added `resolveConflict(c, choice)`.
- **`src/components/ConflictDialog.tsx`** (new) — local vs server side-by-side
  preview, Use server / Use local buttons, non-destructive Escape/backdrop
  dismiss. Reuses the `.note-conflict-*` CSS.
- **`src/App.tsx`** — conflict queue state, reconcile effect captures conflicts,
  `endConflict` pop-and-advance (refresh on a landed write), renders
  `ConflictDialog`.
- **`src/components/SettingsModal.tsx`** — "Conflict resolution" `<select>`,
  seeded from `getConflictStrategy`, persisted immediately.

## Tests added / changed

- `src/lib/conflict.test.ts` (new) — 4 verdict cases.
- `src/settings.test.ts` — strategy default/fallback/round-trip/key-removal.
- `src/api.test.ts` — replaced the `syncFromServer` block with
  `reconcileWithServer` (no-op, in-sync, adopt-server, ask, server, local,
  per-resource failure isolation) and `resolveConflict` (server/local).
- `src/components/ConflictDialog.test.tsx` (new) — title, both versions, both
  button callbacks, dismiss-on-close.

## Verification

- `npx vitest run` → 83 passed (11 files).
- `npm run build` → tsc clean, Vite bundles.
- `cd src-tauri && cargo test` → 30 passed (no Rust changes).
