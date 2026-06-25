# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/15-remove-focus-border/plan.md (CSS-only "remove focus border" plan)
**Health Score:** 99/100
**Trend:** 100 -> 99 (-1) vs last PR Review run

A tight, well-scoped styling plan that correctly separates `outline` (focus ring,
removed) from resting `border` (kept) and documents the accessibility tradeoff
deliberately; one minor redundancy in the rule.

---

## Findings

### Suggestion

**Accidental Complexity — Redundant `:focus-visible` selector**
Symptom: The rule lists both `:focus` and `:focus-visible`, justified as "some
engines draw `:focus-visible` rings that a bare `:focus { outline: none }` would
leave behind." An author-origin `:focus { outline: none }` already overrides the
user-agent `:focus-visible` ring by cascade origin (author beats UA), independent
of selector specificity, in both Chromium (WebView2) and WebKit (the Tauri
webviews). The second selector is belt-and-suspenders, and its stated rationale is
slightly inaccurate.
Source: A Philosophy of Software Design — speculative generality / Refactoring —
Speculative Generality.
Consequence: Negligible today, but the inaccurate comment can mislead a future
maintainer into thinking both selectors are load-bearing, making the rule harder
to simplify safely.
Remedy: Keep both but correct the comment to note `:focus` alone suffices by
cascade origin and `:focus-visible` is defensive, or drop `:focus-visible`.

---

## Summary

The plan is sound and ready: it changes only `outline`, preserves every resting
`border` and the `aria-current` selection highlight, makes no behavioural/test
changes, and treats the keyboard-accessibility loss as an explicit, reversible
product decision. The single Suggestion is cosmetic. Score 99/100 clears the >95
bar — no further plan iteration required.

## Resolution

Comment corrected in the plan: `:focus-visible` kept as a defensive belt-and-
suspenders selector, with the comment now stating `:focus` alone suffices by
cascade origin. No other change needed.
