# Brooks-Lint Review

**Mode:** PR Review
**Scope:** branch changes vs main (production: PickerList.tsx, SortField.tsx, SelectField.tsx, FilterBar.tsx, style.css; tests alongside)
**Health Score:** 98/100

A clean, contained merge: the row body is extracted to one home (`PickerList`),
`SelectField` keeps its exact behaviour, and the new `SortField` carries the only
new behaviour (one modal, two groups, stay-open). Two small knowledge-duplication
notes, both Suggestion-level.

---

## Findings

### 🟢 Suggestion

**R3 Knowledge Duplication — "current option's label, first-option fallback" is expressed twice**
- Symptom: `SelectField` derives its trigger text with
  `const selected = options.find((o) => o.value === value) ?? options[0]` →
  `selected?.label ?? ""`, and `SortField` re-expresses the identical rule in its
  own `labelFor(options, value)` helper. The same "find the option, else the
  first, else empty string" decision lives in two files.
- Source: Hunt & Thomas — *The Pragmatic Programmer*, DRY; Fowler — *Refactoring*,
  Duplicated Code.
- Consequence: if the fallback rule ever changes (e.g. show a placeholder instead
  of `""`), it must be changed in two places and they can drift.
- Remedy: hoist the helper to `PickerList` (its options already live there) as an
  exported `optionLabel(options, value)` and call it from both `SelectField` and
  `SortField`. Low-risk, small win — both triggers already behave identically.

**R3 Knowledge Duplication — the picker shell repeats across SelectField and SortField**
- Symptom: `SortField` re-states `SelectField`'s scaffold — the `.select-field`
  trigger, the `<dialog class="select-modal">` wrapper, the `open`
  `useState`/`useEffect`, and the `.modal-actions` button.
- Source: Hunt & Thomas — *The Pragmatic Programmer*, DRY; Ousterhout — *A
  Philosophy of Software Design* (deep vs shallow modules).
- Consequence: a change to how a picker dialog opens/closes must be made in two
  places.
- Remedy: accept it. The two shells genuinely diverge (close-on-pick + single
  value vs stay-open + `sort · dir` summary + Done); a shared shell would absorb
  those differences as flags/children and become a shallow, parameterized module.
  The open/close `useEffect` is already duplicated by established convention
  (`LabelModal`/`EditTaskModal`/`SelectField`). Extract a `usePickerDialog` hook
  only if a third picker variant appears. Documented trade, not a defect.

## Summary

98/100. The structural decision is sound: extract the drift-prone row into
`PickerList`, leave the inert shell inline. The only actionable item is folding
the two trigger-label derivations into one shared `optionLabel` helper; the shell
duplication is a deliberate, documented trade-off that should stay as-is. Test
coverage for the new behaviour is complete (PickerList row contract, SortField
one-modal/two-choices, FilterBar integration) with no mock abuse or obscure tests.
