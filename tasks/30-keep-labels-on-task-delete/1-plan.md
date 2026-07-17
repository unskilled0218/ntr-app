# 30 - Keep a project/context after its last task is deleted (labels remembered on the server)

## Goal

Deleting the last task that carries a project or context currently makes that label disappear from the filter and the add-form pickers. The user wants a label to survive a task delete, and wants the remembered labels persisted on the server / backend data store -- not in per-device browser storage -- so every device sees the same set. Removing a label stays possible only through the explicit "Remove" action on each label row.

## Why the label vanishes today

Projects and contexts are derived on every reload from the tokens on the current tasks. `loadLabels` (`src/components/TodoPane.tsx:78-95`) collects `t.projects` / `t.contexts` across all tasks into two Sets and sets that as `serverLabels`, clearing any filter selection whose label is no longer present (lines 93-94). So deleting the last `+work` task drops `+work` from every task, from the derived set, and from the pickers. Nothing persists a label on its own, and todo.txt cannot hold an orphan label (a label is only ever a token on a task line), so a remembered label needs a home outside the tasks.

## The idea: a first-class "labels" resource in the data store

Persist a small labels document -- the set of known projects and contexts -- as its own resource in the backend, exactly the way `Note.md` is a resource: a file in the data directory, read and written through both backends (local Tauri commands and the HTTP server). The UI shows the union of that remembered set and the task-derived set, so seeing a label on any task remembers it and deleting tasks never shrinks the shown set. The one thing that forgets a label is the existing Remove-label flow, which strips the token from every task and now also drops the name from the remembered set. Deleting a task deletes a task; removing a label removes a label -- the two stop being coupled.

Because the remembered set only ever grows (except an explicit Remove), any divergence between two devices reconciles by union, so labels need no conflict/"ask" machinery.

### The resource

- File `labels.json` in the data directory, beside `todo.txt` and `Note.md`.
- Shape: `{ "project": string[], "context": string[] }`. Absent/empty/malformed file == `{ project: [], context: [] }`, mirroring the "missing file = empty" rule the stores already use.

## Rust changes -- local backend (`src-tauri/`)

### `src/labelstore.rs` (new)

A `LabelStore` modelled on `NoteStore`, but reusing the task-29 `FileBackend` seam (`backend.rs`: `Arc<dyn FileBackend>` with `read(name)` / `write(name, data)`), so `labels.json` lives in the data dir on both desktop FS and Android SAF with no new IO code:

- `load(backend, name)` -> reads `labels.json`, parses JSON (missing/blank/invalid -> empty), keeps it in memory.
- `get() -> Labels` and `replace(labels)` -> serialise and `backend.write("labels.json", json)`, then swap into memory (the same write-then-swap discipline).
- `set_backend(backend)` for a data-dir change.

`Labels { project: Vec<String>, context: Vec<String> }` (serde) is the wire shape shared with the frontend.

### `src/state.rs`, `src/lib.rs`

- `AppState` gains `labels: Mutex<LabelStore>`; `AppState::new` takes it.
- `lib.rs` `setup` builds it from the same `Arc<dyn FileBackend>` used for the task/note stores and manages it.

### `src/commands.rs`

- `get_labels(state) -> Result<Labels, String>` -> `state.labels.lock().get()`.
- `put_labels(state, labels: Labels) -> Result<(), String>` -> `replace`.
- `set_data_dir`: add `labels.json` (a new `paths::LABELS_FILE` constant) to the set of files moved when the directory changes, and switch the label store's backend alongside the task/note stores, with the same rollback discipline -- so labels travel with the data directory.
- Register `get_labels` / `put_labels` in `lib.rs`'s `invoke_handler`.

Live `change` events for labels are out of scope for v1 (the label set refreshes on the next `loadLabels`, which every task mutation already triggers); noted as a follow-up.

## Rust changes -- HTTP server (`~/workdir/server/`)

Mirror the note resource so server mode has the same endpoint:

- `src/config.rs`: add `labels_file: PathBuf` (default `labels.json`, env `LABELS_FILE`), beside `note_file`.
- `src/labelstore.rs` (new): a path-based `LabelStore` (this backend is FS-only, so it mirrors `note.rs` directly -- load/get/replace over a `PathBuf`, JSON parse, missing = empty).
- `src/api.rs`: `AppState` gains the label store; add `.route("/api/labels", get(get_labels).put(put_labels))`. `get_labels` returns the JSON document; `put_labels` accepts and persists it.
- Watch/live-events for labels: out of scope for v1, same as the local backend.

## Client changes (`src/`)

### `src/api.ts`

- `export interface Labels { project: string[]; context: string[] }`.
- `getLabels(): Promise<Labels>` -- server mode `httpJson<Labels>("/api/labels")`, else `invoke("get_labels")`.
- `putLabels(labels: Labels): Promise<void>` -- server mode `serverFetch("/api/labels", "PUT", JSON.stringify(labels), "application/json")` then best-effort local backup via `invoke("put_labels", { labels })` (mirroring `putNote`'s `backupNoteLocally`), else `invoke("put_labels", { labels })`.
- Graceful degradation: `getLabels` failure (e.g. a server not yet carrying `/api/labels`) is treated by the caller as an empty remembered set, so the app still shows task-derived labels and never breaks against an un-upgraded server.

### `src/components/TodoPane.tsx`

`loadLabels` becomes "read remembered, derive from tasks, show + persist the union":

- Read the remembered set: `const remembered = await getLabels().catch(() => ({ project: [], context: [] }))`.
- Build derived `projects` / `contexts` from tasks as today.
- `merged.project = unionLabels(remembered.project, [...projects])`, same for context (`unionLabels` is a new pure helper in `src/labels.ts`: de-duplicated merge; FilterBar already sorts rows so order is irrelevant).
- `setServerLabels(merged)`.
- Persist only when the union grew beyond what is stored: if `merged` differs from `remembered`, `putLabels(merged)` -- so a newly-seen label is remembered server-side, and a steady state costs no write.
- The filter-clear guards test against `merged`, so a filter resets only when its label is in neither tasks nor the remembered set -- i.e. only after an explicit Remove, never after a task delete.

`confirmRemove` (`TodoPane.tsx:157-174`) forgets the label so Remove still fully deletes it: after stripping the token from every task, `putLabels({ ...remembered, [field]: remembered[field].filter((n) => n !== name) })`, then `loadLabels`. The token is now on no task and no longer remembered, so the union drops it, it leaves the pickers, and its filter selection clears -- unchanged Remove behaviour.

No change to `onDelete` / `onToggle` / `onAdd` / `onEditSave`: they already route through `loadLabels`, so a task delete keeps the label with no extra code.

### Naming note

`serverLabels` is now literally server-persisted-plus-derived, so the prop name reads truer than before; it stays, with an updated comment. A rename remains optional and out of scope.

### Dropping the previous approach

The earlier localStorage design (`getKnownLabels` / `setKnownLabels` in `settings.ts`) is not used; persistence moves entirely to the backend resource above.

## Tests

- Server `labelstore.rs`: missing file = empty; replace-then-get round-trips; malformed JSON = empty.
- Server `api.rs`: `GET /api/labels` returns the stored document; `PUT` persists it (following the existing note endpoint tests).
- Local `labelstore.rs`: same three cases over an `FsBackend` temp dir.
- Local `commands.rs`: `set_data_dir` moves `labels.json` with `todo.txt` / `Note.md` and rolls back on failure (extends the task-29 move tests).
- `src/labels.test.ts`: `unionLabels` merges, de-duplicates, keeps a remembered-only label, and returns `[]` for two empties.
- `src/components/TodoPane.test.tsx` (mock `getLabels` / `putLabels` in the api layer): deleting the last `+work` task leaves `+work` in the pickers and does not clear a `+work` filter, and persists nothing new; the explicit Remove of `+work` calls `putLabels` without it and clears its filter; a `getLabels` rejection still renders task-derived labels.

## Risks and trade-offs

- Server compatibility: an older `my-ntr-server` without `/api/labels` makes `getLabels`/`putLabels` fail; handled by degrading to derived-only labels (no crash), but remembered orphans will not persist there until the server is upgraded. Both repos ship together here, so this only matters for a mixed deployment.
- Two repos: this spans the Tauri app and `~/workdir/server`. Kept symmetric with the existing note resource to hold the surface down.
- No live sync for labels in v1: a second device sees a new remembered label on its next `loadLabels` (any task mutation or reopen), not instantly. Adding `labels` to the `change` stream is the follow-up.
- Unbounded growth: the set only grows until an explicit Remove; label counts are tiny, so no cap. Remove is the release valve.

## Out of scope

Live `change` events for labels; a conflict/"ask" flow for labels (union makes it unnecessary); persisting Add-modal labels never attached to a task (`AddForm`'s `staged` stays session-only); renaming `serverLabels`.

## Verification

`npm test`, `cargo test` in `src-tauri/` and in `~/workdir/server/`. Then drive both modes. Local mode: add a task with `+work`, delete it (its only one), confirm `+work` still appears in the filter and add pickers and that a filter set to `+work` stays selected ("No tasks"); confirm `labels.json` exists in the data directory and holds `+work`; use the label row's Remove and confirm `+work` leaves the pickers, the filter resets, and `labels.json` no longer lists it; reopen the app and confirm the remembered set is intact. Server mode: repeat against a running `my-ntr-server`, confirm `GET /api/labels` reflects the changes and a second client picks the label up on its next refresh.
