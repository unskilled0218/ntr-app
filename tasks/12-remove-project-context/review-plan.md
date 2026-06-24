# 12 - Plan to address code-review.md

Two findings to resolve; both low-risk and self-contained.

## 1. 🟡 Coverage Illusion — pin the `confirmRemove` glue (new test)

Add **`src/components/TodoPane.test.tsx`** (jsdom + Testing Library, mocking
`../api`, mirroring `EditTaskModal.test.tsx`'s mock style and the shared
`<dialog>` polyfill in `src/test/setup.ts`).

The test exercises the one piece of new behavior with no executing test: that
confirming a removal wires `planLabelRemoval` to `updateTask` over the **full**
store and reloads.

- **Mock `../api`** with `vi.fn()`s for every name `TodoPane` imports —
  `listTasks`, `updateTask`, `createTask`, `completeTask`, `uncompleteTask`,
  `deleteTask`, plus a real `errMsg` (`(e) => (e instanceof Error ? e.message :
  String(e))`).
- `listTasks` resolves a fixed three-task fixture regardless of args (so both the
  mount `refresh`/`loadLabels` and `confirmRemove`'s `listTasks({})` see it):
  - `{ id: 1, projects: ["work"], contexts: ["phone"], raw: "call bank +work @phone", ... }`
  - `{ id: 2, projects: ["home"], contexts: [], raw: "tidy +home", ... }`
  - `{ id: 3, projects: ["work"], contexts: [], raw: "post +work", ... }`
  (full `Task` shape: `completed:false, priority:null, completion_date:null,
  creation_date:null, description, tags:{}`.) `updateTask` resolves `undefined`.
- **Test "removing a project updates every task that carries it and reloads":**
  1. `render(<TodoPane />)`; `await` the mount load (e.g. `await screen.findByLabelText(/project filter/i)` and wait until the `work` option exists).
  2. `fireEvent.change` the **Project filter** select (`aria-label="Project filter"`) to `"work"` so the Remove button enables.
  3. Click **Remove project** (`aria-label="Remove project"`).
  4. In `#remove-label-dialog`, click **Remove**.
  5. Assert `updateTask` was called exactly twice — `(1, "call bank @phone")` and
     `(3, "post")` — and **not** for task 2. Assert `listTasks` was called again
     after the confirm (reload). Use `waitFor` for the async loop.
- Optional second test ("a failed update still reloads"): make `updateTask`
  reject once; assert the error text renders (`role="alert"`) and `listTasks` is
  still re-queried (the `catch` reload). Keep it only if it stays simple.

This covers loop count, the stripped argument, full-list scope, and the reload —
exactly the glue the review flagged — without re-testing the pure helpers.

## 2. 🟢 Remove button nested inside the filter `<label>`

In **`src/components/FilterBar.tsx`**, move each Remove `<button>` out of its
`<label>` so the label captions only its `<select>`. The button becomes a sibling
directly after the `</label>`, still inside `#filters`:

```tsx
<label>
  Project
  <select aria-label="Project filter" ...>...</select>
</label>
<button type="button" aria-label="Remove project" disabled={!project}
  onClick={() => onRemove("project", project)}>Remove</button>
```

Same for context. No behavior change: the `aria-label`, `disabled`, and `onClick`
are identical, so `FilterBar.test.tsx` keeps passing unchanged; only the DOM
nesting tidies. Visual grouping is unchanged — both still sit in the `#filters`
row — so no CSS change.

## Verification

- `npm test` — existing suites green; new `TodoPane.test.tsx` green;
  `FilterBar.test.tsx` unchanged and green.
- `npm run build` — type-checks.
