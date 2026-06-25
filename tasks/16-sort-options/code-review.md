# 16 - Code review (brooks-review)

**Mode:** PR Review
**Scope:** src/config.ts, src/components/FilterBar.tsx, src/components/TodoPane.tsx
(+ config.test.ts, FilterBar.test.tsx); version-bump files skipped.
**Health Score:** 99/100 (> 95)

The implementation faithfully matches the reviewed plan: one new helper, two
table entries, one `dir` parameter, one picker, render-only state — and the new
behaviour is covered by tests including the deliberate desc/missing-first
semantics.

## Findings

### Suggestion

**R1 Cognitive Overload (Primitive Obsession) — `sort` and `dir` cross the FilterBar boundary as bare `string`**
- Symptom: `FilterBar.Props` types `sort: string` and the new `dir: string`, and
  `TodoPane` re-narrows with `onDir={(d) => setDir(d as Direction)}` (a cast),
  though `Direction` is a real exported union.
- Source: Fowler — Refactoring (Primitive Obsession); Ousterhout — A Philosophy
  of Software Design (push type knowledge to where it is known).
- Consequence: the compiler can't reject an invalid direction at the prop
  boundary; `as Direction` is an unchecked assertion. Low risk — the only
  producer is the `DIRECTIONS`-derived option list.
- Remedy: optional. Typing `dir: Direction` alone would be *inconsistent* with
  the pre-existing `sort: string` / `status`-cast siblings and with
  `SelectField.onChange`, which deals in raw `string`. Recommend deferring.

## Summary

99/100. Clean, minimal realization of the approved plan with good coverage. The
single suggestion is a pre-existing codebase pattern, not a regression introduced
here.
