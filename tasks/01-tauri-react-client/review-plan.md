# Review remediation plan (addresses code-review.md)

How each finding from `code-review.md` will be implemented. Ordered by the review's recommended
fix order. Scope is deliberately tight: address the findings, do not start a second system.

## 1. Coverage Illusion — test the note autosave + conflict state machine (Warning)

Add `src/components/NotePane.test.tsx` using Testing Library (jsdom + `@testing-library/react`,
both already installed) with `api.ts` mocked via `vi.mock`. Two tests cover the riskiest
transitions named in the finding:

- **autosave**: render NotePane; mock `getNote` → `""`; simulate entering text via the editor's
  **paste** path; advance fake timers past `NOTE_SAVE_DELAY_MS`; assert `putNote` was called once
  with the entered text and the status reads `Saved`.
- **keep-mine conflict**: mock `getNote` initial → `"base"`; enter local edits (now dirty); drive
  a note `change` by calling the imperative `onNoteChange()` after re-mocking `getNote` →
  `"theirs"`; assert the conflict dialog opens; click **Keep mine**; assert `putNote` is called
  with the *local* text (mine wins over the rebased remote).

Notes that keep the test honest and non-brittle:
- **Simulate input via the `paste` event, not `fireEvent.input`.** jsdom does not mutate a
  `contenteditable` element in response to a synthetic `input` event, so firing `input` alone
  would assert against an empty editor — a test that passes without exercising anything. The
  component's `paste` handler calls `spliceNote`, which writes the DOM deterministically through
  the same `setEditorText` path real typing uses and arms the identical autosave debounce, so
  `fireEvent.paste(editor, { clipboardData: { getData: () => "my text" } })` is the reliable,
  behaviour-true way to put text in the editor. (Real keystroke handling is covered indirectly by
  the `caret`/`markdown` unit tests over those same helpers.)
- Use `vi.useFakeTimers()` for the debounce; flush with `await vi.runAllTimersAsync()`, then
  `vi.useRealTimers()` in cleanup.
- Mock only `api.ts` (the seam the plan already isolated) with `vi.mock("../api")` — no DOM/Tauri
  stubbing — so the test exercises the real state machine, not a reimplementation of it.
- Assert on observable behaviour (`putNote` args, visible status text, the dialog), never on
  internals, so a later refactor that preserves behaviour keeps the tests green.
- Grab the editor with `container.querySelector("#note-input")` (a `contenteditable` div is
  matched by `getByRole("textbox")` too; either works) and the dialog buttons by their text.
- **Dependency check:** `@testing-library/react` v16 needs `@testing-library/dom` as a peer; if
  it is not already present, install it (`npm i -D @testing-library/dom`) — network is available
  in this environment.

This is the only finding that adds behaviour-level safety; it goes first.

## 2. Knowledge Duplication — one error-message helper (Suggestion)

Add to `src/api.ts`:

```ts
// Turn any thrown value (IPC errors arrive as strings; JS errors as Error) into a message.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
```

Replace every `(err as Error).message ?? err` / `?? String(err)` in `TodoPane.tsx` and
`NotePane.tsx` with `errMsg(err)`. `api.ts` is the right home: it is where IPC rejections (plain
strings, per the Rust commands' `Result<_, String>`) originate, so the "what does a thrown value
look like" decision sits next to the boundary that produces them. Add a two-line test for it
(`errMsg(new Error("x")) === "x"`, `errMsg("y") === "y"`) — same standard the PR is held to, no
"optional" hedge.

## 3. Accidental Complexity — collapse TodoPane's three reload paths (Suggestion)

Make `loadLabels` independent of `project`/`context` so it is stable and the `eslint-disable`
disappears:

- Inside `loadLabels`, drop a vanished filter using the **functional updater form**, which reads
  the latest state without closing over it:
  ```ts
  setProject((p) => (p && !projects.has(p) ? "" : p));
  setContext((c) => (c && !contexts.has(c) ? "" : c));
  ```
  With no `project`/`context` in its dependency list, `loadLabels` is created once (`useCallback`
  with `[]`).
- Reload triggers then collapse to two clear paths: the existing `useEffect([refresh])` (filter
  changes refetch the list), and a single mount effect `useEffect(() => { loadLabels(); }, [loadLabels])`
  plus the `useImperativeHandle` for live `change` events. The mount `eslint-disable` is removed
  because `loadLabels` is now a correct, stable dependency.
- `useImperativeHandle(ref, () => ({...}), [refresh, loadLabels])` gets a dependency array so it
  is not rebuilt every render (both deps are now stable), removing the third "recreated each
  render" path the finding called out.

Behaviour is unchanged (same fetches on mount, on filter change, on mutation, on live event); the
control flow is just legible and lint-clean. Re-run `vitest` + `tsc` to confirm no regression.

## 4. Cognitive Overload — extract a `useNoteSync` hook (Suggestion) — DEFERRED

The review marked this **optional** ("not required for correctness; do it if the file grows
further"). Decision: **defer**, and record why. `NotePane` is a faithful, well-commented port of
`app.js`'s note section; extracting a hook now is a speculative restructure (Second-System
restraint) that would churn the most delicate code in the PR for no behaviour change, right after
adding its first tests. It is logged in the task's future-work list. Revisit if the file gains
new responsibilities.

## Verification

After 1–3: `npx vitest run` (now includes the NotePane component tests), `npx tsc --noEmit`,
`npm run build`, and `cd src-tauri && cargo test && cargo clippy --all-targets` (unchanged, but
re-run to prove the frontend-only edits did not touch the backend). Record results in
`review-implemented.md`.

## Out of scope (unchanged from plan.md)

Server sync, multi-window, the shared todo.txt crate, and now the `useNoteSync` extraction.
