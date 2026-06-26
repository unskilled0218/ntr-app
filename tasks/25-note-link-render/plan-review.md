# Brooks-Lint Review

**Mode:** PR Review
**Scope:** plan only — `tasks/25-note-link-render/plan.md` (design for rendering note Markdown links as clickable text with caret-line reveal)

This review iterates the plan per `agents/PLAN.md` step 3 (iterate brooks-review until the Health Score exceeds 95). Round 1 reviews the original plan; Round 2 confirms the revised plan.

---

## Round 1

**Health Score:** 94/100

A clean, invariant-preserving design with one structural risk in the NotePane wiring and one efficiency nit.

### Findings

#### 🟡 Warning

**Change Propagation — the reveal re-tag must be remembered at every render site**
Symptom: The plan calls `markEditLine()` separately at the end of `rerenderNote`, `spliceNote`, and `adoptNote` (the three paths that re-render the editor's `innerHTML`, which drops the `md-edit` class). A future fourth render path would silently forget the re-tag and the reveal would desync from the render.
Source: Fowler — Refactoring (Shotgun Surgery); Ousterhout — A Philosophy of Software Design (Information Leakage: "rendering happened" is a fact every render site must re-encode).
Consequence: The "after rendering, re-tag the caret's line" decision lives in N places; adding a render path requires editing all of them, and the failure mode (a stale/blank edit line) is easy to miss in review.
Remedy: Route all three render paths through one local write wrapper `paint(text, caret)` that calls `setEditorText` then `markEditLine`, giving the re-tag a single home. (`setEditorText` itself stays in `caret.ts`, unaware of `md-edit`.)

#### 🟢 Suggestion

**Accidental Complexity — `selectionchange` does line-walking work while the editor is unfocused**
Symptom: The `selectionchange` listener is document-global; the original guard let it call `markEditLine` (which walks every line `<div>` to toggle a class) on every selection change anywhere in the app, no-op'ing only inside `setEditLine`.
Source: McConnell — Code Complete, Ch. 5 (do not pay for work you do not need); Hunt & Thomas — Orthogonality (a note-pane concern reacting to unrelated UI selection).
Consequence: Typing in the add-task field or a modal triggers an O(lines) DOM toggle pass over the note on every keystroke — wasted work that grows with note length.
Remedy: Guard on `document.activeElement === editor()` at the top of the listener so it returns immediately when unfocused, and clear the tag explicitly in the existing `onBlur` (which `selectionchange` does not reliably cover) so collapse-on-leave still happens.

### Accepted, not actioned

- **`data-href` duplicates the URL already in the `md-url` span.** The raw URL must stay in the span as text (THE LINE INVARIANT), and the handler needs it as an attribute to read on click. These are one datum serving two mechanically-different needs, not a duplicated decision — keeping both is required, not debt.
- **The `md-link` / `md-link-mark` / `md-url` / `md-edit` class contract spans `markdown.ts`, `style.css`, and `editLine.ts`.** This is the codebase's established HTML/CSS rendering boundary (already true for `md-mark` / `md-line` / `md-h*`); it is conceptual integrity with the existing design, not new leakage.

---

## Round 2 (after applying the two remedies)

**Health Score:** 99/100

Both findings actioned in `plan.md`:
- A single `paint(text, caret)` wrapper now owns "render then re-tag"; the three render paths delegate to it. Shotgun-surgery risk removed.
- The `selectionchange` listener now early-returns unless the editor is focused, and `onBlur` clears the tag. No work while unfocused.

The remaining 1-point deduction is the accepted, documented `data-href`/`md-url` URL duplication, which is required by the invariant and intentionally kept.

## Summary

The design is sound: it preserves THE LINE INVARIANT by hiding (never removing) link syntax, leaving `caret.ts` and the round-trip test untouched, and it reveals the raw Markdown via a pure class toggle rather than a re-render (avoiding caret/selection disruption and re-entrancy). The two round-1 issues — a multi-site re-tag and unfocused line-walking — are fixed by funneling renders through one `paint` wrapper and focus-guarding the listener. Final score 99/100, clearing the >95 gate; proceed to implementation.
