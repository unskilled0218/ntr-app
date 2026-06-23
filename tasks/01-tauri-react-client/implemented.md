# 01 - Tauri + React client — implementation notes

Implements `plan.md` (which passed brooks-review at 99/100). The app is a local-first port of the
`my-ntr-server` WebUI: a Tauri + React desktop/mobile client backed by local `todo.txt` /
`Note.md` files, with the same UI and behaviour.

## What was built

### Backend (`src-tauri/src/`)

- **Ported verbatim from `workdir/server/src/`** (each with a provenance header):
  `task.rs`, `atomicfile.rs`, `store.rs`, `note.rs` — the todo.txt model, atomic writes, the
  id-stable write-then-swap store, and the single-Markdown-note store. Their unit tests came
  across unchanged (20 tests, all passing).
- **New glue:**
  - `dto.rs` — `TaskDto` (the server's exact JSON shape) + `from_entry`.
  - `paths.rs` — the one home for file locations (`app_data_dir()/todo.txt`, `/Note.md`) and the
    two surviving config constants (`ADD_CREATION_DATE = true`).
  - `state.rs` — `AppState { store: Mutex<Store>, note: Mutex<NoteStore> }`.
  - `commands.rs` — the 11 Tauri commands replacing the HTTP routes (list/create/get/update/
    complete/uncomplete/delete tasks, get/put raw, get/put note). Thin shells: lock, call the
    store, map errors to `String`, return data. **They do not emit events.**
  - `watch.rs` — the **single emitter** of `change` events: a 1s poll that reloads both stores
    from disk and emits `change`/`"tasks"` or `change`/`"note"` only for out-of-band edits.
  - `lib.rs` — `setup` loads the stores into managed state and spawns the watcher; registers the
    command handlers.
- `Cargo.toml` gained `chrono` (clock) and `tokio` (time).

### Frontend (`src/`)

- `style.css` — copied verbatim from `web/style.css` (provenance header); class names preserved
  so it needed no re-authoring.
- `api.ts` — the only Tauri-aware module: `invoke` wrappers, the `Task` type (= `TaskDto`), the
  `CHANGE_*` event tokens, and `onChange` (`listen`).
- `config.ts` — `KINDS`, `STATUSES`, `SORTS`, `VIEWS`, sentinels, timings, `sortTasks`,
  `cmpMissingLast`.
- `markdown.ts` — the pure in-place Markdown highlighter (ported lines 686–806 of `app.js`).
- `lib/caret.ts` — the caret / line-invariant helpers (`readNoteText`, `getCaret`, `setCaret`,
  `setEditorText`).
- `lib/noteSync.ts` — pure `classifyNoteEvent`.
- `labels.ts` — pure `composeText` + `parseLabelInput`.
- Components: `App` (layout, view state, swipe, live `change` subscription), `NotePane`
  (imperative child-free contenteditable + autosave state machine), `NoteConflictDialog`,
  `TodoPane`, `AddForm` (+ label staging), `LabelModal`, `FilterBar`, `TaskItem`.

The contenteditable invariant from the plan is enforced: the editor `<div>` is rendered
child-free with `suppressContentEditableWarning`, and all of its DOM is written through the
caret/markdown helpers via a ref — React never renders into it.

## Verification

- `cd src-tauri && cargo test` → **20 passed** (ported parser/store/note invariants).
- `cd src-tauri && cargo clippy --all-targets` → **clean** (no warnings).
- `npx vitest run` → **22 passed** across 5 files: `markdown` (line invariant + classes),
  `caret` (getCaret/setCaret inverse), `labels` (composeText/parseLabelInput), `config`
  (sortTasks/cmpMissingLast missing-last), `noteSync` (the four verdicts).
- `npm run build` (`tsc && vite build`) → **clean** (type-checks and bundles).

### Not run here (headless container)

`npm run tauri dev` / `tauri build` were not launched — this environment has no display/webview
runtime. The Rust lib+bin compile (so `generate_context!` and the command wiring are valid) and
the frontend builds, but the live GUI smoke test (add/complete/edit a task, type Markdown and
watch it render + autosave, edit the files on disk and watch the panes update, resize to mobile
and swipe) should be done interactively with `npm run tauri dev` on a machine with a display.

## Deviations from the plan

None of substance. The watcher loop scopes its lock guards in a block (rather than the plan's
prose) to satisfy the borrow checker and clippy; behaviour is identical (no lock held across
`emit`).
