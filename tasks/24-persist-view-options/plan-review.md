# Plan review — 24-persist-view-options

## Brooks-Lint PR Review (plan), round 1 — 99/100

One sentence: a tight, well-reasoned plan that adds persistence in the file that already owns
every other preference, reuses the config tables for validation, and pre-empts the obvious
over-engineering — one minor duplication worth noting.

### 🟢 Suggestion — R3 Knowledge Duplication: default literal in both getter and setter

- Symptom: each option's default appears twice — `getStatus` falls back to `"all"` and
  `setStatus` treats `"all"` as the remove-the-key case (same for `file`/`asc`).
- Source: Hunt & Thomas — The Pragmatic Programmer, DRY.
- Consequence: changing a default later means editing two lines that must stay in sync.
- Remedy: accepted as-is — mirrors the established `getConflictStrategy`/`setConflictStrategy`
  idiom; extracting per-option default constants would diverge from it and cost conceptual
  integrity for a one-token literal. Recorded in plan.md ("Accepted trade-off") rather than
  changed.

### Clean dimensions

- R2 Change Propagation: localized to settings.ts + TodoPane.tsx; also removes the prior
  default-literal duplication (was in TodoPane useState initializers).
- R4 Accidental Complexity: rejects a speculative `usePersistentState` hook; validation
  fallback is justified by a real scenario (task 16's removed `alpha`).
- R5 Dependency Disorder: new `settings -> config` edge analyzed; `config -> api` is
  type-only (erased), so runtime chain `api -> settings -> config` has no cycle.
- R1/R6: clean.

### Outcome

99 ≥ 95 on round 1 — plan passes. Proceed to implement.
