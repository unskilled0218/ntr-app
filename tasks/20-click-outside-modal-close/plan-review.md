# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/20-click-outside-modal-close/plan.md (round 1)
**Health Score:** 99/100 (> 95, passes; no iteration needed)

A disciplined plan: it adds **one** behaviour (`useBackdropClose`), homes it once,
and has every dialog opt in with a single line — explicitly declining the
`<Modal>` wrapper that task 18's review already rejected. It respects both existing
close conventions without changing either, and it corrects two doc comments that
falsely claimed backdrop dismissal already worked.

## Findings

### 🟢 Suggestion

**R1 Cognitive Overload — the dismiss expression `(onClose ?? (() => dialog.close()))()` is dense**
- Symptom: the hook resolves the dismiss inline as a nullish-coalesced IIFE
  invoked immediately — three ideas (default, override, call) on one line.
- Source: McConnell — *Code Complete*, Ch. 31 (lay out one idea per line);
  Ousterhout — *A Philosophy of Software Design* (obvious code).
- Consequence: a reader pauses to parse a one-liner whose intent ("dismiss: use
  the override if given, else close natively") could be read at a glance.
- Remedy: minor — in implementation, name it:
  `const dismiss = onClose ?? (() => dialog.close());` then
  `if (e.target === dialog) dismiss();`. Same behaviour, one idea per line. Adopt
  when implementing; not a plan blocker.

## Resolution applied to the plan

Two points were checked and judged already-resolved, so no plan change:

- **Eight files change (potential R2 Shotgun Surgery)**: all eight are dialog
  components in one module changing for one reason — adopting a shared primitive —
  which the decay-risk guide explicitly classifies as normal coordinated change
  within a bounded context, not shotgun surgery. The *decision* lives in exactly
  one place (`useBackdropClose`); a future dialog is one line. With native
  `<dialog>`s there is no way to apply a behaviour to all instances without a
  per-instance opt-in short of the rejected wrapper. Not a finding.
- **Optional `onClose` parameter (potential R4 Speculative Generality)**: the
  parameter exists because exactly two real dialogs (SettingsModal, EditTaskModal)
  drive close through React state and would desync on a raw `dialog.close()`; the
  default serves the other seven. Justified by present need, not future-proofing.

## Summary

99/100, over the 95 bar. Strongest moves: capturing "click outside closes" as one
behaviour hook (not nine copies, not a shallow wrapper), defaulting to the dialog's
own native close so the four native-close dialogs and the three pickers need zero
bespoke logic, and isolating the override to the two state-driven dialogs that
genuinely require it. The lone note is a one-line readability tidy to apply during
implementation.
