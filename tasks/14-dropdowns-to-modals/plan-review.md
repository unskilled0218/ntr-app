# 14 - Plan review (brooks-review)

## Round 1 — 98/100

**Mode:** PR Review · **Scope:** `plan.md` (round 1) · **Trend:** 98 → 98 (stable)

Two 🟢 Suggestions, no Critical/Warning. Cleared the >95 bar on round 1.

- **R3 — Priority option list built in both AddForm and EditTaskModal.**
  Remedy: define `PRIORITY_OPTIONS` once in `config.ts` and import in both forms.
  → Applied: step 5 now uses a shared `PRIORITY_OPTIONS`.

- **R2 — wide blast radius (~12 files).** Accepted: a one-time migration to a
  shared component, every site a dropdown, with future changes localizing to
  `SelectField`. Remedy: record that the migration must land atomically (no mixed
  native-`<select>` + picker state).
  → Applied: new "Migration must land atomically" section (target: zero
  `<select>` left in `src/`).

Both notes folded into `plan.md`; mechanism unchanged. Plan accepted for
implementation.
