# Plan review — 11 add project/context from the app

brooks-review (PR Review mode) on `plan.md`, iterated to the 95+ gate.

## Round 1 — 93/100

- 🟡 Coverage Illusion — the only regression test sat at the `LabelModal` level
  (synthetic parent form), proving the portal *mechanism* but not the reported
  *symptom* in `AddForm` (lost selection + stray task from the bubbled submit).
- 🟢 Knowledge Duplication — two portalled `LabelModal` instances share
  `id="label-modal"` under `<body>` (pre-existing duplicate id, unaddressed).
- 🟢 Accidental Complexity — portal not strictly required for `AddForm`; the
  fragment-sibling alternative was not weighed, so the uniformity read as
  incidental rather than deliberate.

## Changes made

- Added a primary **call-site** regression test in `AddForm.test.tsx`: stage a
  project through the modal with a description present, assert the project stays
  selected and `onAdd` is never called — the exact reported failure. Kept the
  `LabelModal.test.tsx` mechanism test as a secondary guard; noted
  `EditTaskModal` is covered by the same structural fix. (Resolves W1.)
- Added a "shared `id`" subsection: the duplicate id pre-exists, CSS matches by
  id, control is ref-based, only one modal opens at a time; single-app-level
  consolidation is out of scope. The trade is now recorded, not accidental.
  (Resolves S1.)
- Spelled out the fragment-sibling alternative and why the portal is used at
  both sites (only mechanism correct for the `dialog`-in-`dialog` edit case):
  one rule everywhere, a conceptual-integrity choice. (Resolves S2.)

## Round 2 — 99/100

- 🟢 Knowledge Duplication (shared id) — intentionally kept; documented trade,
  no reachable consequence in a ref-driven, one-open-at-a-time codebase.

## Round 3 — 99/100 (correctness revision)

During implementation, the round-1/2 design (render `LabelModal` via
`createPortal(..., document.body)`) was found **incorrect**: a React portal moves
only DOM parentage, while React dispatches `onSubmit` along the **React component
tree**. A portalled modal written inside `<form id="add-form">` would still
bubble its submit into `add-form.onSubmit` — the actual defect the user feels.
The portal would have hidden the invalid nested-`<form>` HTML without curing the
bug.

Corrected root cause and fix:

- `AddForm` renders `LabelModal` as a React **descendant** of its form;
  `EditTaskModal` renders it as a **sibling** (after `</form>`). Only the add
  form bubbles, which is why only it is reported broken.
- Fix: make `AddForm` return a fragment with `<LabelModal>` **after** `</form>`,
  so it is a sibling — matching `EditTaskModal` and the original
  `server/web/index.html`. The portal idea is dropped (and explicitly documented
  as a non-fix). No `LabelModal` change, no new dependency, no CSS change.
- The shared-`id` discussion from round 2 is moot: nothing is portalled, so the
  add-form dialog stays a normal sibling of the form.

Remaining: 🟢 optional `EditTaskModal` characterization test (out of scope,
noted).

Gate cleared (99 ≥ 95). Proceeding to implementation.
