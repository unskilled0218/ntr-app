# 03 - Edit task modal — implementation notes

Implements `plan.md` (passed brooks-review at 100/100 after one iteration addressing two
Warnings: `bareDescription` dependency direction and label-select duplication).

## What was built

### `src/labels.ts` (modified)

Added `bareDescription(description, projects, contexts, tags)`. Takes individual fields (not
`Task`) to keep `labels.ts` dependency-free from `api.ts`. Strips exact token matches so
URLs and unrelated +/@/: characters in the description are preserved.

### `src/components/LabelSelect.tsx` (new)

Shared label-select dropdown extracted from `AddForm`. Owns:
- Options merge: `serverLabels ∪ staged`, sorted
- The `"+ Add…"` sentinel → `onAdd()` callback
- Normal selection → `onChange(value)` callback

Used by both `AddForm` (updated) and `EditTaskModal` (new).

### `src/components/AddForm.tsx` (modified)

Replaced the inline `labelSelect` helper function and `options` helper with `<LabelSelect>`.
Removed unused `ADD_VALUE`, `KINDS`, and `EMPTY_LABEL` imports that were only needed for the
now-extracted dropdown logic.

### `src/components/EditTaskModal.tsx` (new)

Native `<dialog>` following the same `useEffect → showModal()/close()` pattern as
`LabelModal` and `SettingsModal`. Pre-populates fields from the `task` prop on every open:
- `description` via `bareDescription(task.description, task.projects, task.contexts, task.tags)`
- `priority` from `task.priority`
- `due` from `task.tags.due`
- `project` from `task.projects[0]`
- `context` from `task.contexts[0]`

On save: composes text with `composeText`, calls `onSave(id, text)`. On error: shows inline
message, stays open. Cancel / Escape both call `onClose` without saving. Nested `LabelModal`
for adding new labels (same pattern as `AddForm`).

### `src/components/TodoPane.tsx` (modified)

- Replaced `window.prompt` + `updateTask` block with `editTask: Task | null` state
- `onEdit(task)` → `setEditTask(task)` (opens modal)
- `onEditSave(id, text)` → `updateTask`, close, `refresh`, `loadLabels`
- `<EditTaskModal>` added to JSX

### `src/style.css` (modified)

Added `dialog#edit-task-modal` / `::backdrop` / `#edit-task-form` / `#edit-task-form > label`
rules. Field rows inside the form reuse existing `add-fields` and `modal-actions` classes.

## Verification

- `npx vitest run` → **51 passed** (42 existing + 4 `bareDescription` + 5 `EditTaskModal`)
- `npm run build` → TypeScript clean, Vite bundles (216 kB JS, 6.1 kB CSS)
- `cargo test` → 20 pass (no Rust changes)

### Not run (headless)

Interactive smoke test (edit a task, verify field pre-population, change priority and due
date, save, verify list update; Escape and Cancel without saving) requires `npm run tauri dev`
with a display.

## Deviations from the plan

None. The `due` input is `type="date"` so testing-library's `getByRole("textbox")` doesn't
match it; the test uses `getByLabelText` instead (same semantics, correct query).
