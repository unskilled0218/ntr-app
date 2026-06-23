# Brooks-Lint Review — review-plan.md

**Mode:** PR Review
**Scope:** tasks/01-tauri-react-client/review-plan.md (plan to remediate code-review.md findings)
**Health Score:** 97/100
**Trend:** First run — no trend data (review-plan)

The remediation plan is targeted, correctly ordered, and (after the paste-path correction)
technically sound; it adds behaviour-level coverage and removes duplication/clarity debt without
starting a second system.

## Strengths verified against the findings

- **Maps 1:1 to code-review.md.** Each of the four findings has a concrete action; the optional
  one is explicitly deferred with a recorded rationale (Second-System restraint), not silently
  dropped.
- **The test plan is behaviour-true.** It mocks only the `api.ts` seam (already isolated by the
  original plan) and asserts observable behaviour, so it can't become its own coverage illusion.
  The paste-path note removes the real jsdom/contenteditable trap that would have made an
  `input`-based test pass without exercising anything.
- **The TodoPane fix removes the cause, not the symptom.** Using functional state updaters to
  make `loadLabels` dependency-free legitimately eliminates the `eslint-disable` rather than
  just silencing it.

## Findings

### 🟢 Suggestion

**Accidental Complexity — the `errMsg` test note is wishy-washy**
Symptom: Section 2 says a test for `errMsg` is "optional … behaviour is trivial". Leaving it
optional invites the same Coverage-Illusion reasoning the PR is being dinged for, on a (tiny)
new exported function.
Source: Feathers — Working Effectively with Legacy Code (new public behavior gets a test).
Consequence: Minor, but inconsistent with the PR's own standard.
Remedy: Just add the two-line test (`errMsg(new Error("x")) === "x"`, `errMsg("y") === "y"`) to
`labels.test.ts` or a small `api.test.ts`; drop the "optional" hedge.

## Summary

Score 97/100 — over the 95 gate. The plan is ready to implement; fold in the trivial `errMsg`
test (removing the "optional" wording) and proceed to implementation.
