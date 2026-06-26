# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/22-move-settings-button/plan.md (round 1)
**Health Score:** 98/100

A well-structured plan that correctly single-sources the control across two layout slots and keeps the breakpoint in CSS; two small simplifications remain — a prop and an inline callback that are duplicated/unused.

---

## Findings

### 🟢 Suggestion

**Accidental Complexity — the `className` prop on `SettingsButton` serves no call site**
Symptom: `SettingsButton` takes a `className` prop, but the plan's CSS targets the two instances through their containers — `.settings-btn` (base) for the desktop slot and `.bottom-nav .settings-btn` (descendant) for the mobile slot. The desktop call site passes no `className`, and the `bottom-nav__settings` value the mobile slot was to pass is never referenced by any rule. So the prop is an extension point with no current use, and the one class name it would carry is dead.
Source: Ousterhout — A Philosophy of Software Design (general-purpose-by-speculation / "design it twice"); Fowler — Speculative Generality.
Consequence: A parameter that no caller needs invites future callers to invent uses for it and makes the component look more configurable than it is; the unused `bottom-nav__settings` class is a stale token a later reader must check against the stylesheet.
Remedy: Drop the `className` prop; `SettingsButton` takes only `onOpen`. Both slots are already addressable by the container selectors (`.app-header .settings-btn` is just `.settings-btn`; the mobile one is `.bottom-nav .settings-btn`). Remove the `bottom-nav__settings` class from the mobile call site.

**Knowledge Duplication — the open-settings callback is written at both call sites**
Symptom: The plan passes `onOpen={() => setSettingsOpen(true)}` in both the `.app-header` and the `.bottom-nav` slots — the same one-line decision ("open the settings modal") expressed twice.
Source: Hunt & Thomas — The Pragmatic Programmer (DRY); Martin Fowler — Refactoring (Duplicated Code).
Consequence: Trivial today, but it is two homes for one action; if opening settings ever grows (e.g., also blur the editor, or record analytics) both arrows must change together, and one can be missed.
Remedy: Hoist it once in App — `const openSettings = () => setSettingsOpen(true);` — and pass `onOpen={openSettings}` at both slots. (A stable function identity is a minor bonus, not the reason.)

---

## Summary

The plan's core decisions are sound: one `SettingsButton` single-sources the badge rule and click target across two slots, placement rides the existing 720px media query rather than a JS breakpoint, and the `VIEWS`/swipe source-of-truth and `navRef` oracle are untouched. The only changes are to shed a speculative `className` prop (and its dead class) and to hoist the duplicated open-settings callback — both reduce surface area. No Change Propagation, Dependency Disorder, or Domain Distortion risks; the refactor is cohesive and correctly directed. Fold both in and the plan is ready.
