# 01 - Tauri + React client (same UI as the server WebUI)

## Goal

Turn the Tauri scaffold in this repo into a desktop/mobile client that reproduces the
`my-ntr-server` WebUI (`~/workdir/server/web/`) feature-for-feature and pixel-for-pixel,
backed by **local files** instead of an HTTP server. The app reads and writes a local
`todo.txt` and `Note.md`, parses todo.txt with the same rules as the server, and keeps the
same live-update behaviour when those files change out of band.

This is the first client feature. The longer-term `todo.md` goals (server sync, "save local
also") are explicitly **out of scope** here; this plan delivers the **local-only** mode that
`todo.md` lists first ("Local only, no server connection"). The architecture below is chosen
so that a future "with server" mode can be layered on without reworking the UI.

## Why local-first (and not "React app talking to the HTTP server")

`todo.md` lists, in order: `Local only, no server connection`, then `With server`. The
primary mode is local. A Tauri app that just `fetch()`ed the existing server would not be a
client of *local* files at all — it would require the user to run the Rust server separately,
which defeats the "Desktop, mobile support / Local only" goal. So:

- The **todo.txt / Note.md domain logic is ported into the Tauri Rust backend** (it is already
  Rust in `~/workdir/server/src/`), and exposed to the React frontend as **Tauri commands**
  (`invoke`) instead of HTTP routes.
- **Same UI, same behaviour**: the React frontend is a faithful port of `web/index.html`,
  `web/style.css`, and `web/app.js`. Every interaction (add/edit/complete/delete, the four
  add-form controls, the label-add modal, the four filter/sort dropdowns, the in-place live
  Markdown editor with autosave, the note conflict dialog, the mobile bottom-nav + swipe, the
  live updates) is reproduced.

### Boundary: what changes vs. the server, and why

The server's HTTP+SSE transport is replaced by Tauri's `invoke` (commands) + `emit`/`listen`
(events). Everything *below* the transport — the todo.txt parser, the task model, the
write-then-swap store discipline, atomic file writes, and out-of-band reload — is ported
unchanged in spirit so the data model and round-trip stay byte-identical to the server's.

| Server (HTTP)                              | This app (Tauri)                                   |
| ------------------------------------------ | -------------------------------------------------- |
| `GET /api/tasks?filters`                   | `list_tasks(filter)` command                       |
| `POST /api/tasks {text}`                   | `create_task(text)` command                        |
| `GET /api/tasks/{id}`                      | `get_task(id)` command                             |
| `PUT /api/tasks/{id} {text}`               | `update_task(id, text)` command                    |
| `POST /api/tasks/{id}/complete`            | `complete_task(id)` command                        |
| `POST /api/tasks/{id}/uncomplete`          | `uncomplete_task(id)` command                      |
| `DELETE /api/tasks/{id}`                   | `delete_task(id)` command                          |
| `GET /api/raw` / `PUT /api/raw`            | `get_raw()` / `put_raw(text)` commands             |
| `GET /api/note` / `PUT /api/note`          | `get_note()` / `put_note(text)` commands           |
| `GET /api/events` (SSE `change` tasks/note)| Tauri event `change` with payload `"tasks"`/`"note"`|

The DTO shape returned by the task commands is **exactly** the server's `TaskDto`
(`id, completed, priority, completion_date, creation_date, description, projects, contexts,
tags, raw`) so the frontend's task rendering is a direct port.

## Backend (src-tauri)

### Ported modules (from `~/workdir/server/src/`)

Copy these into `src-tauri/src/` essentially verbatim (they are already standalone, no axum
deps), keeping their unit tests so the parser/store invariants are still proven here. **Each
ported file gets a provenance header** — a one-line `//! Ported verbatim from
my-ntr-server src/<file> (workdir/server) — keep in sync if the todo.txt contract changes.` —
because the todo.txt parse/serialize decision now lives in two repos under one `workdir` and a
future format change must touch both (see "Accepted duplication" below).

- `task.rs` — todo.txt parse/serialize/complete/uncomplete + `Derived` (projects/contexts/tags).
  Unchanged.
- `atomicfile.rs` — temp-file + rename atomic write. Unchanged.
- `store.rs` — id-stable in-memory store over a todo.txt file; write-then-swap; `reload_from_disk`.
  Unchanged except it drops nothing (no axum/serde coupling exists today).
- `note.rs` — single Markdown file store; write-then-swap; `reload_from_disk`. Unchanged.

These four files carry their own `#[cfg(test)] mod tests`; they port as-is and keep proving
the round-trip, filtering, id stability, and out-of-band-reload behaviour in `cargo test`.

### New backend glue (replacing `api.rs` + `main.rs` + `watch.rs` + `config.rs`)

- **`paths.rs`** — the one home for "where the files live" **and the two surviving config
  knobs**. Use Tauri's `app.path().app_data_dir()` and store `todo.txt` and `Note.md` there
  (created on first run). This replaces `config.rs`'s env-var paths. Since the env-var config is
  gone, the settings that *do* survive get named constants here rather than becoming magic
  literals inside a command body: `const TODO_FILE: &str = "todo.txt";`,
  `const NOTE_FILE: &str = "Note.md";`, and `const ADD_CREATION_DATE: bool = true;` (the
  server's default). So "do we stamp creation dates? where are the files?" still has a single,
  greppable home.
- **`dto.rs`** — `TaskDto` (serde `Serialize`) and `from_entry`, ported verbatim from
  `api.rs`. This is the wire contract with the frontend; keeping it identical to the server
  keeps the frontend port mechanical.
- **`state.rs`** — `AppState { store: Mutex<Store>, note: Mutex<NoteStore> }` managed by Tauri
  (`app.manage(...)`). `RwLock` is unnecessary here (commands are short, low-contention);
  `Mutex` keeps it simple. The store/note are the same write-then-swap types as the server.
- **`commands.rs`** — the `#[tauri::command]` functions in the table above. Each is the thin
  shell the server's handlers were: lock state, call the store/note method, map errors to a
  `String` (Tauri commands return `Result<T, String>`), and **return the updated data**.
  `today()` uses `chrono::Local`, same as the server. **Commands do NOT emit `change` events**
  — see "Single emitter" below.
- **`watch.rs`** — the **single emitter** of live-update events. Port the server's file watcher:
  a background task (`tauri::async_runtime::spawn`) polls the two files on the same 1s interval
  and, when `store.reload_from_disk()` / `note.reload_from_disk()` reports a real change, `emit`s
  `change` with payload `CHANGE_TASKS` / `CHANGE_NOTE`. Out-of-band edits to the files are
  reflected live, exactly like the server.
  - *Why polling, not an OS watcher:* the server already chose 1s polling for tiny files and
    documents why (bounded staleness, cheap); matching it keeps behaviour identical and avoids
    adding the `notify` crate.

### Single emitter: why commands stay silent

The server emits on every mutation so *other HTTP clients* reconcile; the initiating browser
updates itself directly from the response. In this app the "other clients" are *other windows*,
and the scaffold ships exactly one (`capabilities/default.json` → `"windows": ["main"]`). If a
command also emitted `change`, that event would be delivered back to the same window that just
refreshed from the command's own return value — a double refetch, and a note-autosave path that
re-enters reconcile against its own write.

So the rule is: **the caller refreshes after its own command (as `app.js` already does after a
successful POST/PUT/complete/delete), and `watch.rs` is the only thing that emits `change`** —
for the one case the caller cannot see, an out-of-band edit to the file. This is strictly
simpler than the server (one emitter, no self-notification) and loses nothing: a command's own
write leaves disk == memory, so even the watcher correctly stays silent for it
(`reload_from_disk` compares the canonical render and returns `false`). If multiple windows
become a real requirement later, re-introduce command emits **then**, as an explicit task — do
not pay for multi-window before it exists (second-system restraint).

### `lib.rs` wiring

Replace the `greet` demo. `run()` builds the store/note from `paths.rs`, `manage`s the state,
`spawn`s the watcher, and registers the command handlers. `Cargo.toml` gains `chrono` (with the
`clock` feature, as the server uses) for dates; `serde`/`serde_json` are already present.

### Change-event tokens: one constant per side

The event payload tokens are a contract split across Rust and TypeScript. To keep a rename or a
new kind from failing silently, each side names them once: Rust keeps the ported `Change` enum
with `as_str()` returning `"tasks"`/`"note"`; TypeScript declares `const CHANGE_TASKS = "tasks"`
and `const CHANGE_NOTE = "note"` in `api.ts`. Each carries a one-line comment pointing at the
other (the server already does this between `Change::as_str` and `app.js`). No new abstraction —
just the two literals given a name and a cross-reference.

### Accepted duplication (provenance, not a shared crate)

`task.rs`/`store.rs`/`note.rs`/`atomicfile.rs`, the `TaskDto` shape, and `style.css` are copied
from the server. These are separate deployable products, so the duplication is defensible — but
it is recorded, not ignored: every ported Rust file carries the provenance header above, and
`dto.rs`/`style.css` get the same one-line "ported from …, keep in sync" note. A shared crate is
the eventual fix and is named in **Out of scope** as a later task; building it now would be
speculative (only two consumers exist, in one `workdir`).

## Frontend (src)

Faithful port of `web/` to React 19 + TypeScript. The DOM structure and CSS class names are
kept so `style.css` ports with near-zero change (only the asset path differs).

### Files

- **`src/style.css`** — copy `web/style.css` verbatim (it is framework-agnostic; class names
  are preserved by the components below). One source of truth for the look; not re-authored.
- **`src/api.ts`** — the transport shim: thin wrappers over `invoke(...)` mirroring `app.js`'s
  `api()`/`fetchNote()`/`putNote()`, plus a typed `Task` interface matching `TaskDto` and the
  `CHANGE_TASKS`/`CHANGE_NOTE` event-token constants. This is the *only* file that knows about
  Tauri (`invoke`, `listen`); every component calls these functions, so a future "with server"
  mode swaps this file alone.
- **`src/markdown.ts`** — port the **pure** Markdown highlighter from `app.js` lines 686–806
  (`highlightMarkdown`, `blockKind`, `formatInline`, `highlightInline`, `escapeHtml`, the
  `LINE` table, regexes). It is already pure (string in, HTML string out) and is the trickiest,
  best-tested-by-eye logic; porting it unchanged (with its line-invariant comments) preserves
  the in-place editor exactly. Unit-tested (see Testing).
- **`src/lib/caret.ts`** — the caret/line-offset helpers (`lineLen`, `readNoteText`,
  `getCaret`, `placeInLine`, `setCaret`, `spliceNote` logic) that implement THE LINE INVARIANT.
  Kept together with `markdown.ts` because they are its exact inverse and must not drift.
- **Components** (one concern each, mirroring the two panes):
  - `App.tsx` — top-level layout: the two panes, the bottom nav, view state (`note`/`todo`),
    swipe handling, and the `change` event subscription that drives live reconcile. Owns the
    `VIEWS` order (one home, as in `app.js`).
  - `NotePane.tsx` — the in-place live Markdown editor (contenteditable), autosave state
    machine (`savedNote`/dirty/debounce/single-flight/beacon), and the focus/blur reconcile.
    Direct port of `app.js`'s note section; uses `markdown.ts` + `caret.ts`.
  - `NoteConflictDialog.tsx` — the two-version `<dialog>` conflict picker (keep-mine / use-theirs,
    Escape = keep-mine), driven by `NotePane`'s `noteConflict` state.
  - `TodoPane.tsx` — the add form, the filter/sort row, and the task list. Holds `state`
    (status/project/context/sort), `lastTasks`, and the staged-label sets.
  - `AddForm.tsx` — description input + priority/due/project/context controls; `composeText`.
  - `LabelModal.tsx` — the `+ Add project/context...` modal; `parseLabelInput` (ported pure,
    unit-tested) + staging.
  - `TaskItem.tsx` — one `<li>`: checkbox, priority/description/meta, Edit/Delete. `editTask`
    uses `window.prompt` exactly as the server does (kept identical for parity; a richer editor
    is out of scope).
  - `FilterBar.tsx` — the Status/Project/Context/Sort selects.
  - Shared config (`KINDS`, `STATUSES`, `SORTS`, `EMPTY_LABEL`, `ADD_VALUE`,
    `NOTE_SAVE_DELAY_MS`) ported to a `src/config.ts` so the label/status/sort tables stay the
    single source they are in `app.js`.

### Behaviours preserved exactly (acceptance checklist)

1. **Add form**: free-text + priority(None/A/B/C) + due date + single `+project` + single
   `@context`; `composeText` builds the todo.txt line in the same order (priority leads).
2. **Label dropdowns** populated from labels present in the file ∪ client-staged; each shows
   only `None` + add-entry until a label of that kind exists; the add-entry is recognised by a
   flag, not its value; choosing it restores the prior pick and opens the modal.
3. **Label modal**: `parseLabelInput` strips leading `+`/`@`, rejects empty/whitespace/`+@:`;
   a valid name is staged and selected; persists only once a task uses it.
4. **Filters**: Status(All/Active/Completed) + Project + Context drive the query (AND); Sort
   (File/Priority/Due/Created/A-Z) is client-side, ascending, missing-last, file-order tiebreak;
   changing a filter refetches, changing sort only re-renders.
5. **Task list**: checkbox toggles complete/uncomplete; priority shown as `(A)`; meta line
   (`created … · done … · +proj · @ctx`); Edit = `prompt` with raw todo.txt; Delete.
6. **Note editor**: single contenteditable that is editor+preview; raw Markdown kept with
   dimmed markers; Enter/paste reimplemented on logical text; autosave (Editing…/Saving…/Saved/
   error), debounce, blur-flush, page-close beacon, IME-safe re-highlight; caret preserved.
7. **Note live sync + conflict**: on a `note` change event, reconcile via the same
   `classifyNoteEvent` verdicts (noop/adopt/in-sync/conflict); a focused-clean editor is left
   alone; conflict opens the two-version dialog; Escape defaults to keep-mine.
8. **Tasks live sync**: on a `tasks` change event, refetch list + labels.
9. **Mobile**: ≤720px shows one pane; bottom-nav buttons + horizontal swipe switch panes; the
   bar's computed display is the single "are we mobile" signal; page never scrolls, panes do.
10. **Layout/CSS**: identical, via the copied `style.css`.

## Testing

- **Rust**: `cargo test` runs the ported `task.rs`/`store.rs`/`note.rs` unit tests unchanged
  (round-trip, filter, id stability, out-of-band reload, empty/missing files). No new logic in
  commands beyond locking + error mapping, so they stay thin.
- **Frontend pure logic**: add Vitest and unit-test the ported pure functions that are easy to
  get subtly wrong — `highlightMarkdown` (each line kind, fenced code, marker-keeping →
  `textContent === source`), the caret line-invariant (`getCaret`/`setCaret` inverse of
  `readNoteText`), `parseLabelInput`, `composeText`, `classifyNoteEvent`, `sortTasks`
  comparators (missing-last). These mirror the behaviours most likely to regress.
- **Manual smoke** (documented in `implemented.md`): `npm run tauri dev` (the dev image is
  `tauri-dev:latest`), add/complete/edit/delete a task, set labels via the modal, type Markdown
  and watch it render + autosave, edit the files on disk and watch the panes update, resize to
  mobile and swipe.

## Risks / notes

- **contenteditable in React**: the editor must NOT be a controlled React node (React would
  fight the DOM and the caret). It is rendered once as a **child-free** JSX element
  (`<div ref={…} contentEditable suppressContentEditableWarning />`, no React children) and
  driven imperatively by the ported `setEditorText`/caret helpers via the `ref`, exactly like
  `app.js` drives the live DOM. React owns the *surrounding* chrome only. ALL editor DOM
  mutation stays inside `NotePane` behind those helpers, with a comment stating the invariant
  (if React re-renders children into this node it will clobber the caret/markup). This is the
  single most important port decision and is why the caret/markdown logic stays vanilla-DOM
  rather than being "Reactified".
- **`dangerouslySetInnerHTML`**: the editor's HTML comes only from `highlightMarkdown`, which
  `escapeHtml`s every source character first (same guarantee the server relied on), so no
  untrusted markup reaches innerHTML.
- **Build deps**: the container is the `tauri-dev:latest` image, expected to have the Rust +
  Tauri toolchain. If `npm install` (adding Vitest) or `cargo build` reports a missing system
  package, STOP and ask the user to install it (per AGENTS.md: "Tell me what I have to install").
- **2-space indent** everywhere (AGENTS.md); no emoji.
- **Scope discipline (second-system risk)**: do not add features the server lacks (tags editor,
  multi-label, themes, server sync). Parity first; `window.prompt` edit stays as-is. New
  capability is a later task.

## Out of scope

Server sync / "with server, save local also" (future `todo.md` item), task versioning
(server's own backlog), import/export, any UI not present in `web/`, multi-window support
(would re-introduce command-emitted `change` events), and a **shared todo.txt crate** to
de-duplicate the parser across the server and this app (the eventual home for the currently
copied `task.rs`/`store.rs`/`note.rs`).
