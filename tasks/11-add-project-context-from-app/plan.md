# 11 - Add a project / context from the app

## Goal

In the desktop app you cannot add a new project from the add form. Open the add
form, open the Projects (or Contexts) select, choose "+ Add project..." /
"+ Add context...", type a name, press **Add** — and the new label is not staged
and not selected. The same flow works on the server, because the server serves
its own original web UI (`server/web/`), which is structured differently. This
task makes the in-app add-form label flow behave exactly like the original.

## Root cause — the label form is a React child of the add form

`LabelModal` renders a native `<dialog>` whose body is its own
`<form id="label-form">` with a submit button ("Add"). The two call sites place
that modal differently in the React tree:

- `AddForm.tsx` (line 106): `<LabelModal>` sits **inside** `<form id="add-form">`
  — a React **descendant** of the add form.
- `EditTaskModal.tsx` (line 126): `<LabelModal>` sits **after** `</form>` (still
  inside the edit `<dialog>`) — a React **sibling** of the edit form, not a
  descendant.

That difference is the whole bug. A `submit` event bubbles, and **React
dispatches `onSubmit` along the React component tree**. So when "Add" is pressed
in the label modal:

- In `AddForm`, the label-form submit bubbles up through the React tree to
  `add-form`'s `onSubmit` as well. `LabelModal.submit` stages the label and
  calls `setProject(name)`; then `AddForm.submit` *also* runs. With a description
  typed, it composes a task, calls `onAdd`, and on success resets the
  fields — including `setProject("")`, throwing away the label just picked. The
  user sees a stray task and no new label. With an empty description it returns
  early, but the bubbling is the same defect.
- In `EditTaskModal`, the label-form submit never reaches `edit-task-form`'s
  `onSubmit` (a sibling is not a React ancestor), so adding a label there already
  works. This is why only the add form is reported broken.

The original web UI (`server/web/index.html`) puts `<dialog id="label-modal">`
as a top-level sibling **outside** `<form id="add-form">`; the React port
regressed only the add-form placement. The fix is to restore that one rule:
**the label form must not be a descendant of the task form.**

## Why not a portal

The tempting fix — render `LabelModal` through `createPortal(..., document.body)`
— does **not** work, and it is worth recording why so no one reaches for it
later. A React portal changes only **DOM** parentage; React still dispatches
events along the **React component tree**, so a portalled `LabelModal` that is
written inside `<form id="add-form">` would *still* bubble its submit into
`add-form`'s `onSubmit`. A portal would hide the invalid nested-`<form>` HTML
without curing the actual event the user feels. The cure is the React-tree
placement, not the DOM placement.

## Design principle — minimal, matches the working sibling and the original

Make `AddForm` render `LabelModal` as a **React sibling** of its form, exactly
as `EditTaskModal` already does and exactly as the original web UI lays out the
markup. `AddForm` currently returns a single `<form>`; wrap the return in a
fragment and move `<LabelModal>` to just after `</form>`.

- One small JSX move in the one component that has the defect. `LabelModal`,
  `EditTaskModal`, `LabelSelect`, the API, the backend, and the CSS are all
  untouched.
- It restores conceptual integrity: after the change **both** call sites share
  the same rule — the label modal is a sibling of the task form, never inside
  it — and that rule matches the reference implementation in `server/web/`.
- `onConfirm` still flows back into `AddForm` by prop (unchanged), so staging and
  selection keep working; only the form-bubbling path is removed.

## Where each concern lives

| Concern | Home | Change |
|---|---|---|
| Add-form / label-modal structure | `AddForm.tsx` | Return `<>...</form><LabelModal/></>`: move the modal out of the form |
| Label modal itself | `LabelModal.tsx` | None — it is already self-contained |
| Edit modal | `EditTaskModal.tsx` | None — already renders the modal as a sibling of its form |

The seam stays narrow: the change is confined to where `AddForm` parents the
modal.

## Implementation

1. **`src/components/AddForm.tsx`** — the component returns
   `<form id="add-form" ...> ... <LabelModal .../> </form>`. Change it to render
   the modal as a sibling:
   ```tsx
   return (
     <>
       <form id="add-form" autoComplete="off" onSubmit={submit}>
         {/* unchanged: add-row + add-fields, including the two LabelSelects */}
       </form>
       <LabelModal kind={modalKind} onConfirm={onConfirm} onClose={() => setModalKind(null)} />
     </>
   );
   ```
   No other line changes. `modalKind`, `onConfirm`, and the `LabelSelect`
   `onAdd={() => setModalKind("project")}` wiring are all as-is; the modal simply
   no longer lives inside the form, so its submit can no longer bubble into
   `AddForm.submit`.

## Tests

Existing suites (`EditTaskModal.test.tsx`, the `labels`/`config` unit tests) must
stay green unchanged.

Add a regression test that fails on the old nested structure and passes after the
move. It belongs at the call site, because the defect is a call-site structural
fact (the modal being inside the form), in a new `AddForm.test.tsx` (jsdom +
Testing Library, mirroring `EditTaskModal.test.tsx`, including its local
`HTMLDialogElement.prototype.showModal/close` stub since jsdom lacks them):

- **"adding a project from the modal keeps it selected and does not submit the
  task"** — render
  `<AddForm serverLabels={{ project: [], context: [] }} onAdd={spy} />`, type a
  description into the task input (`aria-label="New task"`), fire a change on the
  Projects select (`aria-label="Project"`) to the add sentinel value `"+add"` to
  open the modal, type a name into the modal input
  (`aria-label="New label name"`, scoped within `#label-modal`), and click the
  modal's **Add** (the submit button inside `#label-modal`). Assert: the Projects
  select now has the typed value **and** `onAdd` was **never** called. On the old
  structure the modal submit bubbles to `add-form`, so `onAdd` fires and the
  selection is reset — both assertions fail; after the move both hold. This
  reproduces the exact reported failure.
- **"adding a project does not fire onAdd even with the description empty"** —
  same steps without typing a description; assert `onAdd` was not called and the
  label is selected. Guards the empty-description path (where the old bubble was
  a silent no-op rather than a stray task), so the fix is pinned for both paths.

There are two "Add" buttons on screen (the form's submit and the modal's submit),
so scope the modal interactions with `within(document.getElementById("label-modal"))`
to avoid clicking the wrong one.

## Out of scope

- No persistence model change. todo.txt has no label store; a staged label
  becomes permanent only when a task using it is saved — the intended design,
  identical to the original (`server/web/app.js`: "todo.txt has no label store,
  so a brand-new label lives here until a task using it is saved"). This task
  only restores the ability to **stage and select** a new label from the add
  form.
- No backend, API, transport, or CSS change. The defect is purely the React-tree
  placement of one component; `src/api.ts`, `src-tauri/`, and `src/style.css`
  are untouched. The `dialog#label-modal` CSS still matches the moved dialog.
- `EditTaskModal` is left as-is. Its modal is already a sibling of its form, so
  adding a label there already works; touching it would be change without cause.

## Verification

- `npm test` (vitest) — existing suites green, new `AddForm.test.tsx` green.
- `npm run build` (tsc + vite) — type-checks unchanged.
- Manual, local mode: add form -> "+ Add project..." -> type -> Add -> the new
  project is selected in the dropdown and **no** stray task is created; then
  submitting a task with it persists it (it appears in the filter list).
- Manual: confirm the Contexts select behaves the same, and that a normal task
  add (no label) still works and resets the form.
