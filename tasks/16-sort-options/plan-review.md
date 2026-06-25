# 16 - Plan review (brooks-review)

**Mode:** PR Review
**Scope:** tasks/16-sort-options/plan.md (round 1)
**Health Score:** 99/100 (> 95, passes; no iteration needed)

A tight, single-home plan that reuses the existing `cmpMissingLast` / `SORTS`
machinery and documents its one debatable semantic choice instead of hiding it.

## Findings

### Suggestion

**R4 Accidental Complexity — `firstLabel` fully sorts an array to read one element**
- Symptom: `firstLabel` does `[...labels].sort()[0]` — allocates a copy and fully
  sorts the label array only to take the minimum, from inside a `compare` callback
  that `Array.prototype.sort` calls O(n log n) times.
- Source: Ousterhout — A Philosophy of Software Design (complexity the problem
  doesn't require); Fowler — Refactoring (repeated derived computation).
- Consequence: each comparison redundantly copies and sorts both operands' label
  arrays. Negligible for a todo list's sizes, but more work than the result needs.
- Remedy: take the min directly — `labels.length ? labels.reduce((m, x) => (x < m ? x : m)) : null`
  — or keep `.sort()[0]` for readability with a comment that label arrays are
  short so the cost is intentional. Borderline note, not a blocker.

## Resolution applied to the plan

Adopted the `reduce`-based min in `firstLabel` (no array copy, no full sort) so
the implementation carries no redundant work; the plan's `firstLabel` snippet is
updated to match. All other plan decisions stand unchanged.

## Summary

99/100, over the 95 bar. Strongest move: naming the one real design decision
(desc negates the comparator, so "missing-last" becomes "missing-first") and
choosing the conceptually-integral rule "desc is the exact reverse of asc", with a
test that locks that semantics in. Only note was a cosmetic micro-allocation in
`firstLabel`, now resolved.
