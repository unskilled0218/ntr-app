# Brooks-Lint Review

**Mode:** PR Review
**Scope:** branch `tauri-react-client` vs `main` — the Tauri+React client implementation
(sampled: >500 lines; the ported-verbatim server modules and `Cargo.lock` are excluded as
generated/derived, focus is on the new hand-written glue and React components)
**Health Score:** 93/100
**Trend:** 99 → 93 (−6) over last 2 runs

Solid, faithful implementation with clean transport isolation and passing tests; the gaps are
test coverage of the new stateful UI and two small duplication/clarity items.

---

## Findings

### 🟡 Warning

**Coverage Illusion — the new stateful UI logic has no automated test**
Symptom: Tests cover the pure helpers (`markdown`, `caret`, `labels`, `config`, `noteSync`) but
the most intricate *new* code — `NotePane`'s autosave/dirty/single-flight/conflict state machine
and `TodoPane`'s label-staging/filter-reload flow — is exercised only by the (un-run, headless)
manual smoke test. The single highest-risk behaviour added in this PR (note autosave + conflict
resolution) has zero coverage.
Source: Feathers — Working Effectively with Legacy Code, Ch. 1 (untested behavior is, by
definition, legacy the moment it ships); Meszaros — xUnit Test Patterns (test the behavior, not
just the pure leaves).
Consequence: A future refactor of the autosave timing or the conflict guards can silently break
"keep mine saves my text over theirs" or "a focused-clean editor is left alone" with nothing to
catch it; the green suite would give false confidence.
Remedy: Add a focused component test (Testing Library + the already-installed jsdom) that mocks
`api.ts` and asserts at least: (1) typing marks dirty and a debounced `putNote` fires with the
typed text; (2) `resolveNoteConflict(false)` (keep-mine) PUTs the local text after rebasing on
the remote. Two tests cover the riskiest transitions without trying to test the whole machine.

### 🟢 Suggestion

**Knowledge Duplication — the error-message extraction idiom is copy-pasted**
Symptom: `(err as Error).message ?? err` / `?? String(err)` appears ~7 times across `TodoPane`
and `NotePane`.
Source: Hunt & Thomas — The Pragmatic Programmer, DRY.
Consequence: The "how do we turn an unknown thrown value into a string" decision lives in seven
places; a change (e.g. to show a code) means editing all of them, and they already differ
slightly (`?? err` vs `?? String(err)`).
Remedy: One tiny helper, e.g. `errMsg(e: unknown): string` in `api.ts` (where the IPC errors
originate), used by every catch.

**Accidental Complexity — TodoPane's reload orchestration is hard to follow**
Symptom: Data reloads are driven by three overlapping mechanisms: a `useEffect([refresh])`, a
mount-only `useEffect(() => loadLabels(), [])` with an `eslint-disable` for exhaustive-deps, and
a `useImperativeHandle` (no deps) recreated every render. "When does the list/labels reload?"
takes real effort to answer, and the disabled lint hides a deliberately stale closure.
Source: Ousterhout — A Philosophy of Software Design, Ch. 3 (pull related logic together) /
Ch. 4 (deep, simple interfaces).
Consequence: A maintainer adding a reload trigger may double-fetch or reintroduce a stale-closure
bug; the eslint-disable normalises silencing the very check that would warn them.
Remedy: Make `loadLabels` not depend on `project`/`context` (read them via the functional
`setProject`/`setContext` updaters to drop a vanished filter), then call `refresh`/`loadLabels`
from one mount effect and the imperative handle — removing the eslint-disable and the third path.

**Cognitive Overload — NotePane bundles the whole note state machine in one component**
Symptom: `NotePane.tsx` (~230 lines) holds the editor DOM bridge, the autosave timer/single-
flight logic, the reconcile/conflict logic, and the JSX. It faithfully mirrors `app.js`, but in
`app.js` these were module-level functions, not one unit.
Source: McConnell — Code Complete, Ch. 7 (routine/▮unit size and single purpose).
Consequence: The component is at the upper bound of what fits in one mental load; the autosave
logic and the conflict logic can only be understood together even though they are separable.
Remedy: Optional — extract the autosave/reconcile logic into a `useNoteSync(editorRef)` hook
returning `{ status, conflict, handlers }`, leaving `NotePane` as the view. Not required for
correctness; do it if the file grows further.

---

## Summary

The most important follow-up is testing the note autosave + conflict state machine — it is the
riskiest new behaviour and currently has no net under it. The two duplication/clarity
suggestions (an `errMsg` helper; simplifying TodoPane's reload paths) are quick wins. Recommended
fix order: (1) add the two NotePane tests, (2) `errMsg` helper, (3) TodoPane reload cleanup;
the NotePane extraction is optional and can wait.
