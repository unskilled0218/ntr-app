# Brooks-Lint Review

**Mode:** PR Review
**Scope:** task 20 changes (production: useBackdropClose.ts [new], usePickerDialog.ts, SettingsModal.tsx, EditTaskModal.tsx, LabelModal.tsx, ConflictDialog.tsx, NoteConflictDialog.tsx, RemoveLabelDialog.tsx; tests: SelectField/RemoveLabelDialog/SettingsModal; version bumps)
**Health Score:** 99/100

A faithful, single-concept implementation of the approved plan: "click outside
closes" lives once in `useBackdropClose`, every dialog opts in with one line, and
the two close conventions already in the codebase are both honoured unchanged. The
plan-review's readability tidy was applied (named `dismiss`, not an inline IIFE).
Five new tests cover all three wiring variants plus negative (inner-click) cases.

---

## Findings

### 🟢 Suggestion

**R4 Accidental Complexity — the backdrop listener re-subscribes each render for the two override callers**
- Symptom: `useBackdropClose`'s effect lists `[dialogRef, onClose]`; SettingsModal
  and EditTaskModal pass an `onClose` prop whose identity can change per parent
  render, so the `addEventListener`/`removeEventListener` pair re-runs on those
  renders. (The seven default-path callers pass no `onClose`, so they subscribe
  once.)
- Source: Ousterhout — *A Philosophy of Software Design* (minimize incidental
  cost); McConnell — *Code Complete* (do the obvious cheap thing).
- Consequence: a few redundant listener swaps on dialogs that re-render — no
  correctness impact (the listener is stateless and the cleanup is exact).
- Remedy: accept it. Stabilising the callbacks would push `useCallback` up into
  App/EditTaskModal for a listener that is cheap to re-add and only exists while a
  dialog is mounted — spreading complexity outward to avoid a negligible cost.
  Borderline note, not a blocker.

## Notes (checked, no finding)

- **Eight files touched (potential R2 Shotgun Surgery)** — all dialog components in
  one module adopting one shared behaviour; the decision is single-homed in
  `useBackdropClose` and a future dialog is one line. Coordinated change within a
  bounded context, not shotgun surgery.
- **Per-site wiring comments repeat** — each is contextualised to its dialog's
  dismiss semantics (non-destructive / keep-mine / onCancel / state-driven), so
  they aid local reading rather than duplicate a decision.
- **Tests** — new behaviour covered (backdrop closes; inner content does not) with
  descriptive names and no mock abuse; the default and override paths are both
  exercised. No Coverage Illusion.

## Summary

99/100, over the 95 bar — no iteration needed on the implementation. The strongest
calls: one behaviour hook instead of nine copies (and not the shallow `<Modal>`
wrapper task 18 rejected), a default that reuses each dialog's own native close so
seven of nine callers need zero bespoke logic, and the override confined to the two
dialogs that genuinely drive close through React state. The lone note (listener
re-subscription) is a deliberate stop short of pushing memoization upward.
