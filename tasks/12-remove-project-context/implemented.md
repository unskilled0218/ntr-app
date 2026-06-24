# 12 - Remove a project / context — implemented

Implements `plan.md` (plan-review round 2: 99/100). Version bumped 0.2.1 → 0.3.0
(new feature, minor bump on the 0.x line).

## Changes

- **`src/labels.ts`** — two new pure helpers beside the existing family; module
  header broadened to cover removal; import gains `type Kind`. Still config-only
  (no `./api` import).
  - `removeLabel(raw, kind, name)` — strips the one whitespace-delimited token
    `prefix+name` from a raw todo.txt line by whole-token equality, preserving
    every other token and collapsing the gap.
  - `planLabelRemoval(tasks, kind, name)` — the pure removal decision: for every
    task carrying the name (by parsed `projects`/`contexts`), `{ id, text }` with
    the token stripped. Typed over a local `Tagged` structural shape so the pure
    module stays decoupled from the transport shim; `api.Task` is structurally
    assignable.
- **`src/components/RemoveLabelDialog.tsx`** — new confirm dialog, mirroring
  `ConflictDialog` (open-driven-by-a-nullable-prop, native `<dialog>`,
  `.modal-actions`/`.primary`, non-destructive dismiss). Names the token and
  confirms before the destructive multi-task rewrite.
- **`src/components/FilterBar.tsx`** — new `onRemove(kind, name)` prop and a
  **Remove** button beside each label `<select>`, disabled while the filter is
  "All …" so it can only act on a concrete selected label.
- **`src/components/TodoPane.tsx`** — `removing` state; `onRemove` opens the
  dialog; `confirmRemove` fetches the full list (`listTasks({})`), applies
  `planLabelRemoval` via sequential `updateTask`s, then `refresh()` +
  `loadLabels()` (the `catch` reloads too, matching `onToggle`). Renders
  `RemoveLabelDialog`.

No backend, HTTP, or CSS change. Removal is existing `updateTask` calls and
reused styles, so it works in both local and server mode unchanged.

## Tests (added)

- `src/labels.test.ts` — `removeLabel` (token strip + gap collapse, `@` prefix,
  whole-token safety `+work`/`+workshop`/`homework`, completion+dates preserved,
  absent name) and `planLabelRemoval` (per-carrying-task plan, context field,
  empty plan).
- `src/components/RemoveLabelDialog.test.tsx` — closed when `target` null; open +
  token shown; Remove → `onConfirm`; Cancel → `onCancel`.
- `src/components/FilterBar.test.tsx` — Remove disabled on "All"; click calls
  `onRemove` with the selected project / context.

## Verification

- `npm test` — 106 passed (14 files). Existing suites unchanged.
- `npm run build` (tsc + vite) — type-checks and builds clean.
