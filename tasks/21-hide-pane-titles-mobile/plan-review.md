# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/21-hide-pane-titles-mobile/plan.md (round 1)
**Health Score:** 99/100

A tight, correctly-scoped plan that puts the mobile-layout decision where the codebase already keeps it (one CSS rule in the existing media query) and explicitly refuses to duplicate the breakpoint — only the title selector could be marginally more intention-revealing.

---

## Findings

### 🟢 Suggestion

**Knowledge Duplication / Hyrum's Law — the `.pane h1` selector encodes "any pane title" by structure, not "these two titles" by name**
Symptom: The rule is `.pane h1 { display: none }`. It matches the two pane titles today only because they are the sole real `<h1>` elements under a `.pane` (the plan documents this: Markdown headings render as `.md-h1` divs, not `<h1>`). The selector leans on that implicit, codebase-wide invariant rather than naming the two titles it means to hide.
Source: Ousterhout — A Philosophy of Software Design (define behavior precisely / "define errors out of existence"); Hyrum's Law (downstream code relies on the structural accident that no other `<h1>` lives in a pane).
Consequence: If a later change adds a legitimate `<h1>` inside either pane (a section heading, an empty-state title), it would be silently hidden on mobile with no obvious cause — a latent surprise that costs debugging time, not correctness today.
Remedy: Scope to the two panes by name with a descendant (not child) combinator: `.note-pane h1, .todo-pane h1`. Note the descendant combinator is required, not cosmetic — `NotePane`'s `<h1>` is a direct child of `.note-pane` (NotePane.tsx:181) but `TodoPane`'s `<h1>` is nested inside `.todo-header` (TodoPane.tsx:177-178), so a `>` child combinator would miss the todo title. This expresses intent ("the note and todo pane titles") while matching both correctly. Minor: `.pane h1` is also correct and simpler; adopt the named form only because this codebase values precise expression.

---

## Summary

The plan is sound and ready: it makes a one-line, single-home CSS change, names every layout and accessibility consequence, and deliberately avoids a second copy of the 720px breakpoint (its strongest decision). The only refinement is to name the two titles in the selector rather than rely on "the only `<h1>` in a pane" holding forever — a small robustness gain worth taking given the codebase's bar. No Change Propagation, Accidental Complexity, Dependency Disorder, or Domain Distortion risks: the change is one presentational rule with no new abstraction, import, or markup.
