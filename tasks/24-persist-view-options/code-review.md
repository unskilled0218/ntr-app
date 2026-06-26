# Code review — 24-persist-view-options

## Brooks-Lint PR Review (code), round 1 — 99/100

Scope: `src/settings.ts`, `src/components/TodoPane.tsx`, + tests.

One sentence: clean, idiom-matching implementation; the only finding is the same deliberate
duplication accepted at plan time.

### 🟢 Suggestion — R3 Knowledge Duplication: default literal in getter and setter

- Symptom: `getStatus` falls back to `"all"` while `setStatus` treats `"all"` as the
  remove-the-key case (same for `"file"` / `"asc"`).
- Source: Hunt & Thomas — The Pragmatic Programmer, DRY.
- Consequence: changing a default later means editing two lines that must stay in sync.
- Remedy: keep as-is — mirrors the established `getConflictStrategy` / `setConflictStrategy`
  idiom; extracting default constants would diverge from it. Accepted, not actioned.

### Clean dimensions

- R5 Dependency Disorder: `settings -> config` adds values + types; `config -> api` is
  type-only, so the runtime chain `api -> settings -> config` is acyclic. Verified.
- R4 Accidental Complexity: no speculative abstraction; three honest inline handlers.
- R2 / R1 / R6: localized change, tiny functions, domain-matching names.
- Test check: new behavior covered (settings validation + TodoPane seed/write-through),
  real localStorage (no mock abuse), scenario-named tests.

### Outcome

99 >= 95. The sole finding is a pre-accepted trade-off -> no code change. See review-plan.md.
