# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/12-remove-project-context/plan.md (round 2)
**Health Score:** 99/100
**Trend:** 93 → 99 (+6) over last 2 runs

All three round-1 findings are resolved: `labels.ts` stays config-only via the
local `Tagged` structural type, the whole-token-vs-substring distinction is
documented on `removeLabel`, and `confirmRemove`'s `catch` now reloads like
`onToggle`. One cosmetic note remains.

---

## Round 1 findings — resolution

- 🟡 **Dependency Disorder (labels → api)** — RESOLVED. `planLabelRemoval` now
  types its input over a local `Tagged = { id; projects; contexts; raw }`; no
  `./api` import, `Task` remains structurally assignable. ISP-clean.
- 🟢 **Knowledge Duplication (two strip paths)** — RESOLVED. `removeLabel` carries
  a comment stating whole-token equality is deliberate and why `bareDescription`'s
  substring replace must not be substituted.
- 🟢 **Change Propagation (error path)** — RESOLVED. `catch` now `refresh()` +
  `loadLabels()`, matching the `onToggle` idiom.

---

## Findings

### 🟢 Suggestion

**Cognitive Overload — note the incidental whitespace normalization**
Symptom: `removeLabel` rebuilds the line with `split(/\s+/).join(" ")`, so a
rewritten line also collapses any pre-existing run of multiple spaces to one.
Source: McConnell — Code Complete, Ch. 7 (no surprising side effects in a helper).
Consequence: Negligible — it only affects lines actually being rewritten and
produces canonical single-spaced todo.txt — but an unstated side effect can
surprise a future reader diffing task files.
Remedy: One clause in the `removeLabel` comment: "also normalizes internal
whitespace on rewritten lines (canonical single spacing)." No code change needed.

---

## Summary

The plan is ready to implement: the risky logic is isolated in two pure,
unit-tested helpers; the module layering is clean; the UI reuses the established
`<dialog>` and filter-select idioms. The lone remaining item is a one-line
comment clarifying whitespace normalization. Proceed to implementation.
