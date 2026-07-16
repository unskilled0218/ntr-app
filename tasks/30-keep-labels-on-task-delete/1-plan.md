# 30 - Keep a project/context after its last task is deleted

## Goal

Deleting the last task that carries a project or context currently makes that label disappear from the filter (and the add-form pickers). The user wants a label to survive: deleting a task must never delete a project/context. Removing a label stays possible, but only through the explicit "Remove" action that already exists on each label row.

## Why the label vanishes today

Projects and contexts have no independent existence in the app -- they are derived on every reload from the tokens on the current tasks. `loadLabels` (`src/components/TodoPane.tsx:78-95`) fetches all tasks, collects `t.projects` / `t.contexts` into two Sets, and sets that as `serverLabels`; it also clears any filter selection whose label is no longer in the derived set (lines 93-94). So when the last `+work` task is deleted, `+work` is in no task, drops out of the derived set, disappears from the pickers, and a filter pinned to it is reset. This matches the original web app ("keep across reloads while it still exists"). Nothing persists a label on its own, so there is nowhere for an orphaned label to live.

The todo.txt file cannot hold an orphan label either -- a label is only ever a token on a task line -- so keeping a label with no task requires storing the set of known labels somewhere outside the tasks.

## The idea: remember labels; only an explicit Remove forgets them

Add a persistent set of "known labels" per kind and show the union of it and the task-derived set. The moment a label is seen on any task it is remembered; deleting tasks then never shrinks the displayed set. The one thing that forgets a label is the existing Remove-label flow, which already strips the token from every task -- it also drops the name from the remembered set, so Remove keeps working exactly as before and stays the single way a label goes away.

This makes the two operations mean what the user expects: deleting a task deletes a task; removing a label removes a label. They stop being coupled.

Persistence lives in `localStorage`, alongside the other per-device view state (`status`, `sort`, `dir` in `src/settings.ts`). Labels are not written to the todo.txt (keeping the file a pure todo.txt document, as today) and, like the rest of the view state, they are per-device. The trade-offs of that choice are in "Risks" below.

## Changes

### `src/settings.ts`

Add a known-labels store following the existing get/set idiom (validate/parse on read, tolerate a missing or malformed key by returning empty):

- `getKnownLabels(kind: Kind): string[]` -- reads `ntr.labels.project` / `ntr.labels.context`, each a JSON string array; returns `[]` when absent or unparseable.
- `setKnownLabels(kind: Kind, names: string[]): void` -- writes the array, or removes the key when the array is empty (empty == absence of key, as `setStatus`/`setSort` represent their defaults).

Two keys (one per kind) mirror how each existing setting owns its own key. `Kind` is already exported from `config.ts`.

### `src/labels.ts`

Add one pure helper (unit-testable, no DOM):

- `unionLabels(known: string[], derived: string[]): string[]` -- the de-duplicated merge of the remembered labels and the labels found on tasks. Order is irrelevant downstream (FilterBar already sorts label rows, `FilterBar.tsx:52`), but the helper returns a stable, de-duplicated list.

### `src/components/TodoPane.tsx`

`loadLabels` becomes "derive, then merge with remembered, persist the merge, show the merge":

- After building the derived `projects` / `contexts` Sets, compute `merged.project = unionLabels(getKnownLabels("project"), [...projects])` and the same for context.
- `setKnownLabels("project", merged.project)` and `setKnownLabels("context", merged.context)` -- so any label newly seen on a task is remembered from now on.
- `setServerLabels(merged)` instead of the raw derived set.
- The filter-clear guards (lines 93-94) test against `merged` instead of the derived Set: a filter is only reset when its label is in neither tasks nor the remembered set -- i.e. only after an explicit Remove, never after a task delete.

`confirmRemove` (the explicit Remove flow, `TodoPane.tsx:157-174`) drops the name from the remembered set so Remove still fully deletes the label. After the per-task token stripping and before/with the trailing `loadLabels`: `setKnownLabels(kind, getKnownLabels(kind).filter((n) => n !== name))`. Because the token is now on no task (not derived) and no longer remembered, the subsequent `loadLabels` union excludes it, it leaves the pickers, and its filter selection clears -- unchanged Remove behaviour.

No other call site changes: `onDelete`, `onToggle`, `onAdd`, `onEditSave` already route through `refresh` + `loadLabels`, so they inherit the new union automatically. Deleting a task therefore leaves the label in place with no extra code.

### Naming note

`serverLabels` is now "known + derived", no longer purely server/task-derived. Renaming it ripples through `FilterBar`, `AddForm`, and `EditTaskModal` props, so to keep this change focused the prop name stays and its comment is updated to say it is the union. A rename to `labels` is a reasonable follow-up but is out of scope here.

## Tests

- `src/settings.test.ts`: `getKnownLabels` returns `[]` when the key is absent and when it holds malformed JSON; `setKnownLabels` round-trips an array and removes the key when passed `[]`; the two kinds use independent keys.
- `src/labels.test.ts`: `unionLabels` merges and de-duplicates, keeps a remembered label absent from the derived list, and returns `[]` for two empty inputs.
- `src/components/TodoPane.test.tsx`: after deleting the last task carrying `+work`, `+work` is still offered in the filter/add pickers (union kept it) and a filter pinned to `+work` is NOT cleared; after the explicit Remove of `+work`, it is gone from the pickers and its filter selection is cleared. Follows the existing TodoPane test style (mock the api layer; assert against the rendered pickers).

## Risks and trade-offs

- Per-device: remembered labels live in `localStorage`, so in server mode two devices can show different orphan-label sets. This is consistent with the other per-device view state and is accepted.
- Cross-source bleed: the remembered set is global, not scoped to the current data directory / server URL, so switching data source could surface orphan labels that belonged to the previous source. Mitigation if this proves confusing (kept as a small follow-up, not built here): clear the remembered set when the data directory or server URL changes.
- Unbounded growth: the remembered set only ever grows until an explicit Remove. In practice label counts are tiny; no cap is added. Remove remains the release valve.

## Out of scope

Persisting labels created in the Add modal but never attached to a task (the `staged` set in `AddForm` stays session-only, `AddForm.tsx:28-40`); scoping remembered labels per data source; renaming `serverLabels`; any server-side label store.

## Verification

`npm test`, then drive the app: add a task with `+work`, confirm `+work` appears in the filter and add pickers; delete that task (its only one) and confirm `+work` still appears in both and that a filter set to `+work` stays selected (showing "No tasks"); then use the label row's Remove on `+work` and confirm it disappears from the pickers and the filter resets; reload the app and confirm a remembered orphan label is still present.
