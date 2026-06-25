# Brooks-Lint Review

**Mode:** PR Review
**Scope:** task 18 changes since the task-17 commit (production: usePickerDialog.ts, OptionsModal.tsx, SelectField.tsx, SortField.tsx, settings.ts, SettingsModal.tsx, App.tsx, TodoPane.tsx, AddForm.tsx, FilterBar.tsx, style.css; tests alongside)
**Health Score:** 98/100

A clean, presentation-only feature: the `compact` flag is drilled one level and
each row is rendered inline or inside one `OptionsModal`; no sort/filter/label
logic moved, and the task list is untouched as required. The dialog open/close
driver is now correctly single-homed (`usePickerDialog`). Two Suggestions, both
minor.

---

## Findings

### 🟢 Suggestion

**R5 Dependency Disorder — a React hook lives in `src/lib/`, which otherwise holds framework-agnostic modules**
- Symptom: `usePickerDialog` (a React hook — `useState`/`useEffect`/`useRef`) was
  placed in `src/lib/`, alongside `caret.ts`, `conflict.ts`, `noteSync.ts`, which
  are framework-agnostic TS with no React import. Its only three callers are all
  components.
- Source: Martin — *Clean Architecture* (package cohesion: things that change
  together / share a dependency live together); Ousterhout — *A Philosophy of
  Software Design* (consistency aids understanding).
- Consequence: `src/lib` stops being "the React-free utility layer" — a small
  conceptual-integrity erosion that makes the layer's rule ("no framework here")
  no longer hold, so the next contributor can't rely on it.
- Remedy: move the hook to `src/components/usePickerDialog.ts`, colocated with the
  three pickers that consume it, and update the three imports. One file move, no
  behaviour change.

**R3 Knowledge Duplication — the dialog body chrome repeats across SortField and OptionsModal**
- Symptom: after `usePickerDialog` removes the open/close duplication, `SortField`
  and `OptionsModal` still each spell out `<dialog className="…-modal">` + `<h2
  className="select-modal-title">` + a trailing `.modal-actions` Done button,
  differing only in the middle content.
- Source: Hunt & Thomas — *The Pragmatic Programmer*, DRY; Ousterhout — deep vs
  shallow modules.
- Consequence: a change to the modal chrome touches two files.
- Remedy: accept it. A shared "modal body" wrapper would be a shallow component
  whose only job is to slot `children` between a title and a Done button, and
  `SelectField`'s body diverges again (Cancel, close-on-pick). The drift-prone
  pieces are already single-homed (`PickerList` for the row, `usePickerDialog` for
  the driver); extracting the chrome too would be the over-abstraction this change
  otherwise avoids. Borderline note, not a blocker.

## Summary

98/100. The structural calls are right: scope held to presentation, the third
dialog caller used as the moment to extract `usePickerDialog` (paying down task
17's deferred debt), and `compact` threaded explicitly rather than read from
storage in leaves. The one actionable item is relocating that hook out of the
framework-agnostic `lib/` layer into `components/`; the residual chrome
duplication is a deliberate stop short of over-abstraction. New behaviour is well
covered (OptionsModal, compact AddForm/FilterBar, settings round-trip + toggle)
with no mock abuse.
