# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/01-tauri-react-client/plan.md (design plan for the Tauri+React client port)
**Health Score:** 88/100
**Trend:** First run — no trend data

The plan is well-reasoned and scopes a faithful port with good transport isolation, but two
design decisions would import avoidable rework: redundant self-notification in a single-window
app, and verbatim cross-repo duplication of the todo.txt contract.

---

## Findings

### 🟡 Warning

**Accidental Complexity — Commands emit `change` events the initiating window already handles**
Symptom: The plan has every mutation command `emit` a `change` event "so other windows
reconcile", while the frontend *also* refreshes directly after each command (the ported
`app.js` POST/PUT/complete/delete handlers all call `refresh()`/`loadLabels()`). The scaffold
ships a single window (`capabilities/default.json` → `"windows": ["main"]`), so that emit is
delivered back to the same window that just refreshed.
Source: Ousterhout — A Philosophy of Software Design, Ch. 3 (Strategic vs. Tactical Programming);
Brooks — The Mythical Man-Month, Ch. 5 (Second-System Effect — porting the server's multi-client
fan-out into a context that has one client).
Consequence: Each add/edit/complete/delete refetches twice (once from the command's own
follow-up, once from the echoed event), and the note autosave path can re-enter reconcile
against its own write. It is wasted work today and a source of confusing feedback loops when
debugging live-sync.
Remedy: Make **`watch.rs` the only emitter** of `change` (its whole job is out-of-band edits);
let commands return updated data and rely on the caller's existing refresh, exactly as `app.js`
already does after a successful HTTP mutation. If/when multiple windows are a real requirement,
re-introduce command emits then and say so — do not pay for multi-window before it exists.

### 🟢 Suggestion

**Knowledge Duplication — todo.txt contract copied verbatim into a second repo**
Symptom: `task.rs`, `store.rs`, `note.rs`, the `TaskDto` shape, and `style.css` are ported
"verbatim"/"unchanged" from `~/workdir/server`. The todo.txt parse/serialize decision and the
wire DTO now live in two places under one `workdir`.
Source: Hunt & Thomas — The Pragmatic Programmer, DRY: Don't Repeat Yourself.
Consequence: A future format or DTO change (e.g. a new tag rule) must be made in both repos or
they silently drift; the round-trip parity the plan promises is unprotected.
Remedy: These are separate deployable products, so duplication is defensible — but record
**provenance**: note the source server commit each file was ported from in a header comment, so
a later format change is traceable to both copies. A shared crate is the long-term fix; call it
out as a future task rather than building it now (YAGNI).

**Change Propagation (Information Leakage) — the `change` payload strings span Rust and TS**
Symptom: The event payload tokens `"tasks"`/`"note"` are a contract split across the emitter
(`watch.rs`/`commands.rs`) and the consumer (`App.tsx`), mirroring the server's
`Change::as_str` ↔ `app.js` split.
Source: Ousterhout — A Philosophy of Software Design, Ch. 5 (Information Hiding and Leakage).
Consequence: Renaming or adding a change kind means editing both ends with no compiler help;
a typo fails silently (no event fires).
Remedy: Define each side's tokens as one named constant/enum (`CHANGE_TASKS`/`CHANGE_NOTE` in
TS; the existing `Change` enum in Rust) and cross-reference them in a comment, as the server
already does. One line per side, not a new abstraction.

**Cognitive Overload — the config home is under-specified after dropping env vars**
Symptom: The plan removes `config.rs`/env vars but does not say where the surviving knobs live —
`add_creation_date` (server default `true`) and `today()`. Today they risk becoming bare magic
literals inside `commands.rs`.
Source: McConnell — Code Complete, Ch. 12 (Fundamental Data Types — name your constants).
Consequence: A reader cannot find "do we stamp creation dates?" in one place; it hides in a
command body.
Remedy: Keep the two surviving settings as named constants in `paths.rs` (or a tiny
`config.rs`) — `const ADD_CREATION_DATE: bool = true;` plus the file names — so the "what is
configurable" answer still has one home even though it is no longer env-driven.

---

## Summary

The most important change is making the file watcher the sole emitter of `change` events so a
single-window app does not double-refresh and self-conflict — that removes a whole class of
live-sync confusion before any code is written. The remaining items are low-cost hygiene
(provenance for the ported files, one constant per side for the event tokens, a named home for
the two surviving config values). Address these and the plan is ready to implement.

---

# Brooks-Lint Review — Round 2 (after plan revision)

**Mode:** PR Review
**Scope:** tasks/01-tauri-react-client/plan.md (revised)
**Health Score:** 99/100
**Trend:** 88 → 99 (+11)

The revision resolves every Round-1 finding; the plan is ready to implement.

## Resolution of Round-1 findings

- **R4 self-notification (Warning) — resolved.** The plan now makes `watch.rs` the *single
  emitter* and commands silent, with an explicit "Single emitter" section and multi-window
  deferred to Out of scope. The double-refetch/self-conflict path is gone by construction.
- **R3 cross-repo duplication (Suggestion) — resolved.** Provenance headers on every ported
  file, an "Accepted duplication" rationale (separate products), and a shared crate named as a
  future task. Defensible and recorded rather than silent.
- **R2 information leakage on event tokens (Suggestion) — resolved.** Each side names the tokens
  once (`Change` enum / `CHANGE_TASKS`+`CHANGE_NOTE`) with a cross-reference comment.
- **R1 config home (Suggestion) — resolved.** `paths.rs` now owns the file names and
  `ADD_CREATION_DATE` as named constants.

## Findings

### 🟢 Suggestion

**Accidental Complexity — the contenteditable/React imperative bridge is the one real hazard**
Symptom: The note editor is a vanilla-DOM, ref-driven `contenteditable` living inside React
(necessarily — a controlled node would fight the caret). This is the highest-complexity area and
the plan flags it but does not yet name a guardrail.
Source: Ousterhout — A Philosophy of Software Design, Ch. 3 (pull complexity into one place).
Consequence: If React ever re-renders the editor's children, it will clobber the caret/markup;
a future contributor may not know that.
Remedy: When implementing, isolate ALL editor DOM mutation in `NotePane` behind the ported
`setEditorText`/caret helpers and render the editor node with a stable, child-free JSX element
(no React children, `suppressContentEditableWarning`), with a comment stating the invariant.
This is an implementation guardrail, not a plan change — noted so it is not forgotten.

## Summary

Score moved 88 → 99. The single remaining item is a Suggestion that is really a note-to-self for
implementation (keep the contenteditable bridge isolated and child-free in React). The plan
passes the >95 gate; proceed to implementation.
