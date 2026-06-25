# 15 - Code review (brooks-review)

## Round 1 — 99/100

**Mode:** PR Review · **Scope:** `src/style.css` (focus-ring removal); version
bumps + `Cargo.lock` skipped (config/generated) · **Trend:** 99 -> 99 (Stable)

One 🟢 Suggestion, no Critical/Warning. The implementation matches the plan
exactly — clean, minimal, no behavioural regression (115 tests green).

### 🟢 Suggestion — Hyrum's Law: universal focus suppression

Symptom: A project-wide `:focus, :focus-visible { outline: none }` strips the
keyboard-focus ring from every control, present and future — text/date inputs, all
dialog buttons, picker rows — not just the trigger buttons that motivated it.
Source: Software Engineering at Google — Hyrum's Law; A Philosophy of Software
Design — information leakage of a global decision.
Consequence: Keyboard / assistive-tech users lose the "where am I" cue app-wide; a
future input added expecting a focus ring silently inherits none.
Remedy: Accepted as a deliberate, documented product decision for this mouse-first
desktop app (state still shown via the caret + `aria-current`), reversible in one
rule. No change required now.

### Strengths confirmed

- Implementation is exactly the plan: one global reset added, the `.note-input:focus`
  accent ring deleted, zero `border` declarations touched.
- `.picker-choice[aria-current="true"]` selection highlight intact.
- No component/config/test behaviour changed; `npm test` 115/115, `npm run build`
  clean as `ntr@0.4.1`.

## Plan to implement the review

See `review-plan.md` (brooks-review on that plan: 100/100). The single Suggestion
is an accepted, documented, one-line-reversible tradeoff, not a defect — no
production change is required. The plan records the decision and the future
narrowing option.

## Verification

- `npm test` — 115 passed (17 files).
- `npm run build` — type-checks and builds clean.
