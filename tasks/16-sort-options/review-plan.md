# 16 - Plan to address the code review

The code review (`code-review.md`) scored **99/100** with a single 🟢 Suggestion
and no Critical or Warning findings. This plan decides what to do about that one
finding.

## The finding

R1 Primitive Obsession — `FilterBar`'s `dir` (and the existing `sort`) prop is
typed `string` rather than the `Direction` union, and `TodoPane` re-narrows with
`onDir={(d) => setDir(d as Direction)}`.

## Decision: deferred, no code change — keep conceptual integrity

This is the rare case where "fixing" the finding makes the code worse, so the
remedy is to **not** change it. Reasoning:

1. **Consistency is the higher value here.** `FilterBar` has four sibling
   choosers — `status`, `project`, `context`, `sort` — all of which cross the
   prop boundary as `string` and are re-narrowed in `TodoPane`
   (`onStatus={setStatus}` over a `Status` cast at the call site, `onSort`, etc.).
   Typing `dir: Direction` alone would make Direction the one special prop in a
   row of four, trading a real, visible inconsistency for a marginal safety gain.
   Conceptual integrity (one rule for the whole filter row) outranks a localized
   type-narrowing on a single prop (Brooks — *The Mythical Man-Month*: conceptual
   integrity is the most important attribute of a design).

2. **The boundary is `string` by construction.** `SelectField.onChange` emits the
   raw option `value: string`; every chooser converts at the `TodoPane` edge. The
   stringly-typed prop is the established, deliberate seam between the generic
   picker and the typed domain, not an oversight in this change.

3. **The risk the finding names is already contained.** The only producer of a
   `dir` value is `DIRECTION_OPTIONS`, derived directly from `DIRECTIONS`, so an
   out-of-union value cannot reach `setDir` in practice. The `as Direction` cast
   documents the seam rather than hiding a real gap.

4. **It is not a regression.** The pattern predates this task; task 16 only
   follows it. Changing it belongs to a separate, whole-filter-row refactor (type
   every chooser's value end-to-end at once), not to this feature.

## If the project ever wants the typed version

Out of scope for task 16, recorded for a future "type the filter row" task:
introduce a generic `SelectField<T extends string>` whose `onChange: (v: T)`, then
type all five choosers (`status`, `project`, `context`, `sort`, `dir`) against
their domain unions in one pass — so the row stays uniform. Doing it for `dir`
alone is explicitly rejected.

## Actions

- No production-code change.
- No test change (the suite already passes 124/124 and covers the new behaviour).
- This decision is the deliverable; `implemented.md` already records the shipped
  code.

## Verification (already green from the implementation step)

- `npm run build` — type-checks and bundles.
- `npm test` — 17 files, 124 tests pass.
