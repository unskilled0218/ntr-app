# Brooks-Lint Review

**Mode:** PR Review
**Scope:** task-25 implementation — `src/markdown.ts`, `src/style.css`, `src/lib/editLine.ts`, `src/lib/openLink.ts`, `src/config.ts`, `src/components/useLinkGestures.ts`, `src/components/OpenLinkDialog.tsx`, `src/components/NotePane.tsx` (+ their tests). Commit `226959f`.

**Health Score:** 98/100

The change implements the 99/100 plan faithfully and preserves THE LINE INVARIANT (the markdown round-trip and caret inverse tests pass unchanged). No Critical or Warning findings; two Suggestions, both accepted with rationale.

---

## Findings

### 🟢 Suggestion

**Change Propagation — `onContextMenu` suppresses the native menu on links for mouse users too**
Symptom: `useLinkGestures.onContextMenu` calls `preventDefault()` for any contextmenu on a `.md-link`. Its purpose is to stop the native long-press menu on touch, but `contextmenu` does not carry a reliable `pointerType`, so a desktop right-click on link text is also suppressed.
Source: Hunt & Thomas — The Pragmatic Programmer (Orthogonality: a touch concern affecting the mouse path).
Consequence: A desktop user loses the browser context menu when right-clicking link text (they can still select/copy normally and right-click elsewhere in the note).
Remedy: Accept. Distinguishing touch vs. mouse `contextmenu` is unreliable across browsers, and suppressing it is exactly what keeps the long-press gesture from being hijacked by the native menu. The cost (no right-click menu on a span of link text in a monospace note editor) is negligible and outweighed by a clean touch gesture.

**Cognitive Overload — the open gesture has no keyboard affordance**
Symptom: A link is opened only by Ctrl/Cmd-click or touch long-press; there is no key to open a focused link. The `<a>` carries no `href`, so it is not in the tab order.
Source: Ousterhout — A Philosophy of Software Design (designing for all the ways a feature is reached).
Consequence: Keyboard-only users cannot open a link from the note.
Remedy: Accept for this task — keyboard opening is explicitly out of scope in `plan.md` (the spec defines pointer gestures only) and is a separate accessibility task. The raw URL is always reachable: putting the caret on the line reveals the full `[text](url)`, which can be selected and copied.

---

## Accepted by design (not findings)

- **`paint` re-tags the caret line even when `setCaret` would also fire `selectionchange`.** This looks redundant on focused renders, but it is the robust choice: on load (`paint(text, null)`) `setCaret` is never called, so no `selectionchange` fires and the explicit `markEditLine` is the only thing that collapses links. Relying on `setCaret`'s internal `addRange` to emit the event would be a Hyrum's-Law dependency on an implementation detail. One explicit home (`paint`) is correct.
- **`data-href` and the `md-url` span both carry the URL.** Required: the span text preserves the invariant and stays editable; the attribute is what the gesture reads. One datum, two mechanically-distinct needs.
- **The `md-link` / `md-link-mark` / `md-url` / `md-edit` class contract spans `markdown.ts`, `style.css`, `editLine.ts`.** The codebase's established HTML/CSS rendering boundary (`md-mark`/`md-line`/`md-h*` already work this way) — conceptual integrity, not leakage.

## Quick Test Check

- New behavior is covered: link markup + attribute escaping (`markdown.test.ts`), `setEditLine` line tagging (`editLine.test.ts`), scheme guard (`openLink.test.ts`), every gesture branch (`useLinkGestures.test.tsx`), and the caret-line reveal/blur-collapse (`NotePane.test.tsx`). No Coverage Illusion.
- No Mock Abuse: the only mocks are the transport/Tauri seams (`../api`, `@tauri-apps/plugin-opener`, `../lib/openLink`); assertions check behavior (markup, class state, calls with the URL), not mock internals.
- Test names state scenario and expected result. No Test Obscurity.

## Summary

The implementation matches the reviewed plan and keeps the delicate editor invariants intact (links hide characters via CSS, never remove them; the reveal is a pure class toggle, not a re-render). The two Suggestions are deliberate scope/limitation trade-offs already reasoned about in the plan, not defects. Score 98/100 clears the >95 gate; no code changes are warranted from this review.
