# 12 - Review fixes implemented

Addresses `code-review.md` per `review-plan.md` (review-plan brooks-review: 99/100).

## Changes

1. **🟡 Coverage Illusion — `confirmRemove` glue now tested.** Added
   `src/components/TodoPane.test.tsx` (mocks `../api`, mirrors
   `EditTaskModal.test.tsx`). Two tests:
   - removing a project calls `updateTask(1, "call bank @phone")` and
     `updateTask(3, "post")` (exactly twice, never task 2) and re-queries the
     store afterward (the reload).
   - a failed update still reloads and surfaces the error.

2. **🟢 Remove button nesting.** `FilterBar.tsx` — each Remove `<button>` moved
   out of its `<label>` to a sibling, so the label captions only its `<select>`.
   Behavior (aria-label, disabled, onClick) unchanged; `FilterBar.test.tsx` stays
   green untouched.

## Improvement discovered while testing the error path

`confirmRemove`'s `catch` originally set the error *then* reloaded (mirroring
`onToggle`). But `refresh()` clears the error at its start, so the trailing
reload wiped the message — a removal failure would show nothing. Reordered the
`catch` to **reload first, then set the error last**, so both the partial-state
reload and the error message survive. This is strictly better than the `onToggle`
idiom it was copied from, and is now pinned by the second TodoPane test.

## Verification

- `npm test` — 108 passed (15 files).
- `npm run build` (tsc + vite) — clean.
