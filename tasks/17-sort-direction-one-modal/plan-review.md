# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/17-sort-direction-one-modal/plan.md (round 1)
**Health Score:** 99/100 (> 95, passes; no iteration needed)

A focused presentation-only plan: it merges the two choosers behind one "Sort"
trigger, extracts the one drift-prone piece (the option row) into `PickerList`,
and leaves the rest of the pipeline (state, `sortTasks`, config) untouched.

---

## Findings

### 🟢 Suggestion

**R3 Knowledge Duplication — the picker shell, not just the row, repeats across SelectField and SortField**
- Symptom: `PickerList` removes the duplicated option-row markup, but `SortField`
  still re-states `SelectField`'s shell: the `.select-field` trigger button, the
  `<dialog class="select-modal">` wrapper, the `open` `useState`/`useEffect`, and
  the `.modal-actions` button. Two components carry the same scaffold.
- Source: Hunt & Thomas — *The Pragmatic Programmer*, DRY; Ousterhout — *A
  Philosophy of Software Design* (shallow vs deep modules).
- Consequence: a future change to how a picker dialog opens/closes (e.g. focus
  handling) must be made in two places, and they can silently drift.
- Remedy: either accept the duplication because the two shells genuinely diverge
  (close-on-pick + single value vs stay-open + `sort · dir` summary + Done), so a
  shared shell would have to be parameterized into a shallow module — or, if a
  third picker variant ever appears, extract a `usePickerDialog` open/close hook
  then. Not extracting a one-more-caller hook today is consistent with the
  existing `LabelModal`/`EditTaskModal`/`SelectField` convention. Borderline note,
  not a blocker.

## Resolution applied to the plan

Kept the decomposition (extract `PickerList`, do **not** extract the shell) and
broadened the plan's "Why a new component" section to justify it explicitly: we
de-duplicate the volatile part (the row) and leave the ~15 lines of stable
button/`<dialog>` scaffold inline, because a shared shell would couple two
deliberately divergent behaviours into a flag-driven shallow module. The finding
is thus a documented, accepted trade rather than an open gap. All other plan
decisions stand.

## Summary

99/100, over the 95 bar. Strongest move: cutting the merge down to presentation
only — no change to sort keys, direction semantics, `sortTasks`, `TodoPane`
state, or `FilterBar`'s Props — and extracting exactly the one piece (`PickerList`)
that would hurt if it diverged. The single note (shell duplication between the two
picker components) is a conscious, now-documented trade-off, not a defect.
