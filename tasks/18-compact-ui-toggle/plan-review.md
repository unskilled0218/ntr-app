# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/18-compact-ui-toggle/plan.md (round 1)
**Health Score:** 99/100 (> 95, passes; no iteration needed)

A disciplined plan: it adds one concept (`OptionsModal`), one setting, and a clean
`compact` prop thread — and it moves **no** sorting/filtering/label logic, only
where the same controls render. It also pays down the dialog-shell duplication
task 17 deferred, exactly at the trigger task 17 named (a third picker variant).

## Findings

### 🟢 Suggestion

**R3 Knowledge Duplication — the dialog *body* chrome still repeats across SortField and OptionsModal**
- Symptom: after `usePickerDialog` extracts the open/close driver, `SortField` and
  `OptionsModal` still each spell out the same body skeleton — `<dialog
  className="…-modal">`, `<h2 className="select-modal-title">{title}</h2>`, and a
  trailing `.modal-actions` Done button — differing only in the middle (PickerList
  groups vs arbitrary `children`).
- Source: Hunt & Thomas — *The Pragmatic Programmer*, DRY; Ousterhout — *A
  Philosophy of Software Design* (deep vs shallow modules).
- Consequence: a change to the modal chrome (title style, Done placement) touches
  two files.
- Remedy: accept it. A shared "modal body" wrapper would be a shallow component
  whose whole job is to slot `children` between a title and a Done button — it
  adds an indirection layer for ~5 lines of stable JSX, and `SelectField`'s body
  differs again (close-on-pick, Cancel not Done). The volatile, drift-prone pieces
  are already single-homed: the row (`PickerList`, task 17) and the open/close
  driver (`usePickerDialog`, this task). Extracting the chrome too would be the
  over-abstraction the plan otherwise avoids. Borderline note, not a blocker.

## Resolution applied to the plan

The strongest candidate finding — the **open/close `useEffect` duplicated a third
time** — was pre-empted in the plan itself: `usePickerDialog` is introduced now
(three real callers: SelectField, SortField, OptionsModal), honouring task 17's
stated "extract when a third variant appears". That converts what would have been
the headline R3 into a resolved item. The residual body-chrome duplication above
is deliberately left as accepted (extracting it would trade real simplicity for a
shallow wrapper). No plan change.

## Summary

99/100, over the 95 bar. Strongest moves: scoping the change to *presentation only*
(no logic relocated, the task list untouched as required), capturing the one new
idea once (`OptionsModal`), and using this task's third dialog caller as the
justified moment to extract `usePickerDialog` — paying down debt task 17 flagged
rather than copying the shell again. The lone note (body-chrome duplication) is a
conscious stop-point short of over-abstraction.
