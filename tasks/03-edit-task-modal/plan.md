# 03 - Edit task modal

## Goal

Replace `window.prompt` in `TodoPane.onEdit` with a proper styled modal dialog that
pre-populates the same structured fields as `AddForm` (description, priority, due date,
project, context). The user can adjust individual fields instead of editing raw todo.txt syntax.

## Motivation

`window.prompt` is unstyled, platform-dependent, and shows raw todo.txt syntax. The same
structured-field UX already exists in `AddForm`; this task brings it to the edit path.

---

## Design

### `src/labels.ts` (modified)

Add one pure function: `bareDescription`. Takes individual fields (not `Task`) so `labels.ts`
stays dependency-free from `api.ts`.

```ts
export function bareDescription(
  description: string,
  projects: string[],
  contexts: string[],
  tags: Record<string, string>,
): string {
  let desc = description;
  for (const p of projects) desc = desc.replace(`+${p}`, "");
  for (const c of contexts) desc = desc.replace(`@${c}`, "");
  for (const [k, v] of Object.entries(tags)) desc = desc.replace(`${k}:${v}`, "");
  return desc.trim().replace(/\s+/g, " ");
}
```

Strips exact tokens (not regexes), so URLs or other `:` / `+` / `@` text outside parsed
fields are left intact. Call site: `bareDescription(task.description, task.projects, task.contexts, task.tags)`.

**Limitation:** if a task has multiple projects or contexts (edited via raw), the modal's
single-select picks only the first (`task.projects[0]`); additional labels are dropped on
save. This matches the add-form's existing single-select constraint.

### `src/components/LabelSelect.tsx` (new)

Extracts the label-select dropdown that `AddForm` currently duplicates inline. Used by both
`AddForm` (updated) and `EditTaskModal` (new). Owns the options merge and the `+ Add…`
sentinel.

Props:
```ts
interface Props {
  kind: Kind;
  value: string;
  serverLabels: string[];
  staged: string[];
  onChange(value: string): void;
  onAdd(): void;    // called when the "+ Add…" entry is chosen
}
```

Internals: computes `options = [...new Set([...serverLabels, ...staged])].sort()`. Renders:
```tsx
<select value={value} onChange={...}>
  <option value={ADD_VALUE}>+ Add {KINDS[kind].singular}...</option>
  <option value="">{EMPTY_LABEL}</option>
  {options.map((name) => <option key={name} value={name}>{name}</option>)}
</select>
```

### `src/components/AddForm.tsx` (modified)

Replace the two inline `labelSelect(...)` calls with `<LabelSelect>`. The `options` helper
and the `labelSelect` inner function are removed; `LabelSelect` owns that logic now.

### `src/components/EditTaskModal.tsx` (new)

Native `<dialog>` (same `useEffect` → `showModal`/`close` pattern as `LabelModal` and
`SettingsModal`). Props:

```ts
interface Props {
  task: Task | null;
  serverLabels: { project: string[]; context: string[] };
  onSave(id: number, text: string): Promise<void>;
  onClose(): void;
}
```

**Fields (controlled):** `description`, `priority`, `due`, `project`, `context`.

`useEffect([task])` opens/closes and resets all fields:
```ts
useEffect(() => {
  const el = dialogRef.current;
  if (!el) return;
  if (task) {
    setDescription(bareDescription(task.description, task.projects, task.contexts, task.tags));
    setPriority(task.priority ?? "");
    setDue(task.tags.due ?? "");
    setProject(task.projects[0] ?? "");
    setContext(task.contexts[0] ?? "");
    setStaged({ project: [], context: [] });
    setError("");
    el.showModal();
  } else {
    el.close();
  }
}, [task]);
```

**Save path:** compose with `composeText`, call `onSave`. `onSave` closes the modal by
nulling the `task` prop (via `setEditTask(null)` in `TodoPane`). On error: catch,
`setError`, stay open so the user can retry.

**Label staging + LabelModal:** identical pattern to `AddForm`. Uses `<LabelSelect>`.

**Cancel:** native `onCancel` (Escape) and Cancel button both call `onClose`.

### `src/components/TodoPane.tsx` (modified)

```ts
const [editTask, setEditTask] = useState<Task | null>(null);

function onEdit(task: Task) {
  setEditTask(task);
}

async function onEditSave(id: number, text: string) {
  await updateTask(id, text);   // throws on error → caught by EditTaskModal
  setEditTask(null);
  await refresh();
  await loadLabels();
}
```

`<EditTaskModal>` added to JSX. The `onEdit` prop shape on `TaskItem` is unchanged.

### `src/style.css` (modified)

`dialog#edit-task-modal` sizing and backdrop (same shape as `dialog#label-modal`), and
`#edit-task-form` flex-column layout. Field rows reuse existing `add-fields` and
`modal-actions` classes.

---

## Files changed

| File | Change |
|---|---|
| `src/labels.ts` | Add `bareDescription` (no new imports) |
| `src/labels.test.ts` | Add tests for `bareDescription` |
| `src/components/LabelSelect.tsx` | New: shared label-select dropdown |
| `src/components/AddForm.tsx` | Use `LabelSelect`, remove inline `labelSelect` helper |
| `src/components/EditTaskModal.tsx` | New: edit dialog |
| `src/components/EditTaskModal.test.tsx` | New: field pre-population + save path tests |
| `src/components/TodoPane.tsx` | Replace `window.prompt` with modal state |
| `src/style.css` | Add `dialog#edit-task-modal` + `#edit-task-form` rules |

No changes to `api.ts`, `settings.ts`, `App.tsx`, `TaskItem.tsx`, `LabelModal.tsx`, or Rust.

---

## Tests

### `src/labels.test.ts` (extend)

- Task with one project, one context, one tag → clean description returned.
- Task with multiple projects → all stripped.
- Task with no structured fields → description unchanged.
- Description that is only label tokens → returns `""`.

### `src/components/EditTaskModal.test.tsx` (new)

Mock `api.ts` (same pattern as `NotePane.test.tsx`). Mock `dialog.showModal`/`close`.

- **Pre-population:** render with a task → description, priority, due, project, context
  inputs have the expected pre-filled values (verified via `@testing-library/react`
  `getByDisplayValue` / `getByRole`).
- **Save path:** fill description, click Save → `onSave` called with correctly composed text.
- **Error path:** `onSave` rejects → error message appears, modal stays open.
- **Cancel path:** click Cancel → `onClose` called, `onSave` not called.

---

## Verification

- `npx vitest run` → all existing 42 + new `bareDescription` + `EditTaskModal` tests pass.
- `npm run build` → TypeScript clean, Vite bundles.
- Manual: edit a task — dialog opens with fields pre-populated; change priority and due date;
  save — task updates in the list. Escape and Cancel both close without saving. Editing a task
  with multiple projects preserves the first in the picker; additional labels are dropped on
  save (expected, documented).
