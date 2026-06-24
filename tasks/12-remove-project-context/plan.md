# 12 - Remove a project / context from the app

## Goal

Task 11 let the user **add** a project/context from the add form. This task adds
the symmetric ability to **remove** one. From the filter row the user selects a
specific project (or context), presses a **Remove** button, confirms in a
dialog, and that label is stripped from every task that carried it. Because the
label set is derived from the tasks (there is no separate label store), once no
task references the name the project/context disappears from every dropdown.

## Root cause / model — labels are derived, so "remove" means "untag every task"

There is no label table to delete a row from. `TodoPane.loadLabels()` builds
`serverLabels` by scanning every task's `projects`/`contexts` arrays
(`TodoPane.tsx:60`), and `todo.txt` itself stores a label only as a `+name` /
`@name` token inside a task line. So "remove project +X" is precisely "remove
the `+X` token from every task whose line contains it." After those task lines
are rewritten, the next `loadLabels()` no longer sees the name and it drops out
of the add-form select, the edit-modal select, and the filter select — the same
"keep only while a task still uses it" rule task 11 documented as out of scope
for persistence.

This is the mirror image of add: add **stages** a name in the session until a
task uses it; remove **untags** every task so no task uses it. Both live entirely
in terms of task lines, never a label store.

## Design principle — a pure decision, thin glue, one reused dialog

Three reuses keep the surface minimal and the risky part pure:

1. **The decision is pure and unit-tested.** Two helpers join the existing
   `composeText` / `bareDescription` / `parseLabelInput` family in `labels.ts`:
   - `removeLabel(raw, kind, name)` — strip the one whitespace-delimited token
     `prefix+name` from a raw `todo.txt` line, leaving every other token (the
     `(A)` priority, an `x`/completion prefix, creation date, `due:` tag, and
     **other** labels) intact, then collapse the gap. Whole-token equality is
     what makes it safe: removing `+work` never touches `+workshop`, and the
     word `homework` in the description is not a `+`-token at all.
   - `planLabelRemoval(tasks, kind, name)` — map the tasks that actually carry
     the name (via their parsed `projects`/`contexts` arrays) to
     `{ id, text: removeLabel(t.raw, kind, name) }`. This is the whole
     orchestration decision as a pure function of the current task list: which
     tasks change and to what. It is the deep part and gets the most tests. It
     types its input over a **local structural shape**
     (`{ id; projects; contexts; raw }`), not `api.Task`, so this pure module
     keeps its "depends only on `config`" contract and does not reach up into the
     transport shim — an Interface Segregation fit (it asks for exactly the four
     fields it reads, and `Task` is assignable to it).

2. **The effect is thin glue.** `TodoPane` already owns the task list, the
   filter selection, `updateTask`, `refresh`, and `loadLabels`. Removal is:
   fetch the full list (`listTasks({})`, exactly as `loadLabels` does, so we act
   on the whole store and not the currently-filtered view), run
   `planLabelRemoval`, `updateTask` each entry, then `refresh()` + `loadLabels()`
   — the identical reload pair `onAdd` / `onEditSave` already run. No new
   transport function; `updateTask` already works in both local and server mode,
   so removal is transport-agnostic for free.

3. **Confirmation reuses the native-`<dialog>` pattern.** A new
   `RemoveLabelDialog` mirrors `ConflictDialog` (open-driven-by-a-nullable-prop,
   `showModal`/`close` in a `useEffect`, `.modal-actions` buttons, non-destructive
   dismiss on Escape/backdrop). Removal is destructive and multi-task, so a
   confirm step is warranted; matching `ConflictDialog` means no new dialog idiom
   and no new CSS.

The trigger reuses the **filter selection** the user already made: the Project
and Context filter selects in `FilterBar` already name "the one label I care
about right now." A **Remove** button beside each, enabled only when a specific
label is selected (`value !== ""`, i.e. not "All projects"/"All contexts"), is
the discoverable, no-new-state home for the action.

## Why here, and why not the alternatives

- **Not a backend / API change.** The whole operation expresses as existing
  `updateTask` calls; adding a Rust command or HTTP endpoint would duplicate the
  per-task write path and split the logic across the transport boundary. The
  defect-free seam is to keep removal as composition above `api.ts`, like
  `reconcileWithServer` is composition, not a new endpoint.
- **Not in the add-form `LabelModal`.** That modal stages a *session* name and is
  a child concern of the add/edit forms; removal acts on the *whole store* and is
  a TodoPane-level action. Folding it in would overload a focused component and
  re-introduce the form-bubbling hazard task 11 just removed.
- **Not a free-text "remove which?" prompt.** The filter select is already the
  canonical label picker; reusing it avoids a second list of names that could
  drift from `serverLabels`.

## Where each concern lives

| Concern | Home | Change |
|---|---|---|
| Strip one token from a raw line | `labels.ts` | New pure `removeLabel(raw, kind, name)` |
| Decide which tasks change | `labels.ts` | New pure `planLabelRemoval(tasks, kind, name)` |
| Confirm the destructive action | `components/RemoveLabelDialog.tsx` | New, mirrors `ConflictDialog` |
| Trigger (Remove buttons) | `components/FilterBar.tsx` | Add a Remove button beside each label select + one `onRemove` prop |
| Orchestrate + reload | `components/TodoPane.tsx` | `removing` state, `onRemove`, confirm handler, render the dialog |
| Transport | `api.ts` | None — reuse `listTasks`/`updateTask` |

## Implementation

1. **`src/labels.ts`** — add, beside the existing helpers (the module header
   broadens from "add form and label modal" to also cover removal). The import
   line gains `Kind`: `import { KIND_LIST, KINDS, type Kind } from "./config";`.
   No `./api` import — `labels.ts` stays config-only.
   ```ts
   // Remove the single whitespace-delimited token `prefix+name` from a raw todo.txt
   // line, preserving every other token (priority, x/dates, due:tag, other labels)
   // and collapsing the gap. Whole-token equality is deliberate — NOT bareDescription's
   // substring replace — so removing +work never touches +workshop and the word
   // homework (not a +token) is left alone. Also normalizes internal whitespace on
   // a rewritten line (canonical single spacing); untouched lines are never visited.
   export function removeLabel(raw: string, kind: Kind, name: string): string {
     const token = KINDS[kind].prefix + name;
     return raw.split(/\s+/).filter((t) => t !== token).join(" ").trim();
   }

   // The fields planLabelRemoval reads — a structural subset of api.Task, declared
   // here so this pure module needs no dependency on the transport shim (ISP).
   type Tagged = { id: number; projects: string[]; contexts: string[]; raw: string };

   // The pure removal decision: for every task carrying `name` (by its parsed
   // projects/contexts), the id and the rewritten line with the token stripped.
   export function planLabelRemoval(
     tasks: Tagged[], kind: Kind, name: string,
   ): { id: number; text: string }[] {
     const field = kind === "project" ? "projects" : "contexts";
     return tasks
       .filter((t) => t[field].includes(name))
       .map((t) => ({ id: t.id, text: removeLabel(t.raw, kind, name) }));
   }
   ```
   `Task` (from `api.ts`) is structurally assignable to `Tagged`, so `TodoPane`
   passes its `Task[]` with no cast and `labels.ts` gains no api dependency.

2. **`src/components/RemoveLabelDialog.tsx`** — new, modelled on `ConflictDialog`:
   - Props: `target: { kind: Kind; name: string } | null` (null = closed),
     `onConfirm(): void`, `onCancel(): void`.
   - `open = target !== null`; the same `useEffect` that calls `showModal()` /
     `close()` in step with `open`.
   - Body: an `h2` "Remove {singular}?", a message naming the token
     (`{KINDS[kind].prefix}{name}`) and that it will be removed from all tasks,
     and `.modal-actions` with **Cancel** (`onCancel`) and a **Remove** primary
     button (`onConfirm`). `onClose={onCancel}` so Escape/backdrop cancels
     non-destructively. `aria-label="Remove label"` on the dialog for querying.

3. **`src/components/FilterBar.tsx`** — add one prop `onRemove(kind, name)` and,
   directly after each label `<select>` (still inside that `<label>`), a button:
   ```tsx
   <button
     type="button"
     aria-label={`Remove ${KINDS.project.singular}`}
     disabled={!project}
     onClick={() => onRemove("project", project)}
   >Remove</button>
   ```
   and the context twin. Disabled while the filter is "All …" (`value===""`), so
   the button can only ever act on a concrete, currently-selected label.

4. **`src/components/TodoPane.tsx`** — wire it:
   - `const [removing, setRemoving] = useState<{ kind: Kind; name: string } | null>(null);`
   - `onRemove(kind, name)` → `setRemoving({ kind, name })`.
   - `confirmRemove()`:
     ```ts
     async function confirmRemove() {
       if (!removing) return;
       const { kind, name } = removing;
       setRemoving(null);
       try {
         const all = await listTasks({});
         for (const u of planLabelRemoval(all, kind, name)) await updateTask(u.id, u.text);
         await refresh();
         await loadLabels(); // drops the now-unused name and clears a filter on it
       } catch (err) {
         setError(errMsg(err));
         await refresh(); // reflect whatever landed before the failure (matches onToggle)
         await loadLabels();
       }
     }
     ```
     Sequential `updateTask`s (not `Promise.all`) match the file-backed,
     one-writer model the rest of the app uses and keep server-mode writes
     ordered. The `catch` also reloads, exactly as `onToggle` does, so a partial
     removal never leaves the list/dropdowns misrepresenting the store.
     `loadLabels` already clears a filter selection whose label vanished, so no
     extra filter reset is needed.
   - Pass `onRemove={onRemove}` to `FilterBar`; render
     `<RemoveLabelDialog target={removing} onConfirm={confirmRemove} onCancel={() => setRemoving(null)} />`.

No CSS change: the Remove buttons inherit default button styling and the dialog
reuses `.modal-actions` / `.primary`.

## Tests

Pure-helper tests carry the weight (the decision is where subtle bugs hide):

- **`src/labels.test.ts`** — new `describe("removeLabel")`:
  - strips the token and collapses the gap:
    `removeLabel("(A) call bank +work @phone due:2026-06-30", "project", "work")`
    → `"(A) call bank @phone due:2026-06-30"`.
  - whole-token safety: removing `"work"` leaves `+workshop` and a bare
    `homework` word untouched.
  - context kind uses the `@` prefix.
  - preserves a completion prefix + dates:
    `removeLabel("x 2026-06-02 2026-06-01 tidy +home", "project", "home")`
    → `"x 2026-06-02 2026-06-01 tidy"`.
  - a name not present returns the line unchanged (trimmed).
  - new `describe("planLabelRemoval")`:
    - returns one `{ id, text }` per task carrying the name, skipping tasks that
      do not (matched via `projects`/`contexts`, not raw substring).
    - context kind filters on `contexts`.
    - empty list when no task carries the name.

- **`src/components/RemoveLabelDialog.test.tsx`** — new (jsdom + Testing Library,
  same `<dialog>` polyfill via `src/test/setup.ts`):
  - `target=null` → dialog not open.
  - `target={{kind:"project",name:"work"}}` → open, message contains `+work`;
    clicking **Remove** calls `onConfirm`; clicking **Cancel** calls `onCancel`.

- **`src/components/FilterBar.test.tsx`** — new (no api dependency; FilterBar is
  pure props):
  - the Remove button is **disabled** when the project filter is `""` ("All").
  - with `project="work"`, clicking Remove calls `onRemove("project","work")`.

A full TodoPane orchestration test is intentionally not added: the orchestration
is `planLabelRemoval` (unit-tested) plus the already-exercised
`updateTask`/`refresh`/`loadLabels` glue, so a component test would re-assert the
pure helper through heavy api mocking without covering new logic.

## Out of scope

- No persistence-model change. We do not add a label store; removal is purely
  rewriting task lines, consistent with task 11's note that a label exists only
  while a task uses it.
- No backend, HTTP, or CSS change. `src-tauri/`, the server, and `style.css` are
  untouched; removal is existing `updateTask` calls and reused styles.
- No multi-select / bulk removal and no undo. One label at a time, confirmed; the
  confirm dialog is the guard. (Undo would need history the app does not keep.)
- `EditTaskModal` / `AddForm` are untouched: removal is a store-level action, not
  a per-task field edit.

## Verification

- `npm test` — existing suites stay green; new `removeLabel`/`planLabelRemoval`,
  `RemoveLabelDialog`, and `FilterBar` tests pass.
- `npm run build` (tsc + vite) — type-checks (the new `Task`/`Kind` imports and
  the `FilterBar` prop).
- Manual, local mode: tag two tasks with `+errand`, filter Project → `errand`,
  press **Remove**, confirm → both tasks lose `+errand`, the task list updates,
  and `errand` is gone from the add-form, edit-modal, and filter selects. Cancel
  / Escape leaves everything unchanged. Repeat for a context. Confirm a label
  shared with other labels on a line (`+errand +shop`) only loses `+errand`.
