# Brooks-Lint Review

**Mode:** PR Review
**Scope:** 22-move-settings-button code (round 1) — `src/App.tsx`, `src/components/SettingsButton.tsx` (new), `src/components/SettingsButton.test.tsx` (new), `src/style.css`, version bump in `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`. Skipped: `src-tauri/Cargo.lock` (generated), `.brooks-lint-history.json` (tool artifact).
**Health Score:** 99/100

A clean refactor that lands the reviewed plan: one `SettingsButton` single-sources the control across two layout slots, the breakpoint stays in CSS, and the swipe/`VIEWS` source-of-truth is untouched — only a minor landmark-semantics nuance is worth recording.

---

## Findings

### 🟢 Suggestion

**Domain Model Distortion (a11y semantics) — a non-view control lives inside the "Switch view" nav landmark**
Symptom: On mobile, `<SettingsButton>` is rendered as the last child of `<nav aria-label="Switch view">` (App.tsx:144-159). The settings button is not a view switch, so the landmark's name no longer fully describes its contents.
Source: WAI-ARIA landmark practices (a landmark's accessible name should describe its purpose); Evans — Domain-Driven Design (ubiquitous language: the label should match what is inside).
Consequence: A screen-reader user enumerating the "Switch view" region encounters a control that is not a view switch. The button carries its own `aria-label="Connection settings"`, so it is never unlabelled — the cost is a slightly imprecise region name, not a lost control.
Remedy: Accept as-is (recommended) — see `review-plan.md`. The alternatives (a second landmark wrapping the badge, or renaming the nav) each complicate the `navRef`-based breakpoint oracle (App.tsx:101) and the edge-to-edge nav styling for a marginal naming gain. The self-labelled button in the bar is the deliberate trade-off the plan recorded.

---

## Summary

Nothing blocks merge. The implementation matches the plan that was reviewed to 98/100 and refined: no `className` prop (each slot reached by its container selector), one hoisted `openSettings`, badge logic in one component with a focused test (`[S]`/`[L]`, click). No Change Propagation (one cohesive feature), Knowledge Duplication (single-sourced), Accidental Complexity (the speculative prop was already removed), or Dependency Disorder (presentation → settings, no cycle). The single 🟢 is a known a11y trade-off resolved in the review plan; build is clean at ntr@0.11.0 and the suite is green (21 files, 153 tests).
