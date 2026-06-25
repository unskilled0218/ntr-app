# 15 - Plan to implement the code review

## Findings to address (from code-review.md, brooks-review 99/100)

One 🟢 Suggestion, no Critical/Warning.

### 1. Hyrum's Law — universal focus suppression (accepted, no change)

**Decision:** keep the global `:focus, :focus-visible { outline: none }` as
written. Removing the focus ring everywhere is the stated goal of the task ("don't
need focused border"), and the loss is a deliberate product choice for this
mouse-first desktop app. State is still conveyed where it matters: the
contenteditable note shows a caret, and picker rows show selection via
`.picker-choice[aria-current="true"]`.

**Why no production change:** narrowing the reset to specific button/trigger
classes would *reintroduce* a focus ring on inputs and dialog buttons — the exact
thing the user asked to remove. Scoping would contradict the requirement, not
satisfy the finding. The finding is a recorded tradeoff, not a defect.

**Reversibility (noted for the future):** the whole behavior is one CSS rule. If
keyboard-focus visibility is wanted later, restore a subtle `:focus-visible`
outline (e.g. on interactive controls) — a one-line, self-contained change with no
ripple. This is captured here so the decision is not silently lost.

## Why nothing larger

The implementation already matches the plan one-to-one and the suite is green. The
sole finding is an accepted, documented, one-line-reversible accessibility
tradeoff. No production, test, or structural change follows from it — so no second
review iteration is expected beyond confirming this plan scores > 95.

## Verification

- No code change → `npm test` and `npm run build` remain green from the
  implementation commit (115 passed; builds clean as `ntr@0.4.1`).
