# Code review — 11 add project/context from the app (round 1)

brooks-review (PR Review mode) on the implemented diff
(`src/components/AddForm.tsx`, `src/components/AddForm.test.tsx`). Score: 96/100.

## 🟢 Suggestion — Knowledge Duplication: duplicated `<dialog>` polyfill

`AddForm.test.tsx` repeats the exact `HTMLDialogElement.prototype.showModal/close`
stub already present in `EditTaskModal.test.tsx`. The jsdom workaround is an
environment fact, not a per-test concern; two copies now, and any third dialog
test would copy it again.

Remedy: hoist into a vitest `setupFiles` module and drop the per-file `beforeAll`.

## 🟢 Suggestion — id-based scoping in tests

Tests scope queries with `document.getElementById("label-modal" / "add-form")`
rather than accessible role queries. Justified here (two same-named "Add"
buttons; the modal needs an unambiguous container), so left as-is.

See `review-plan.md` for the fix plan (brooks-reviewed at 100/100).
