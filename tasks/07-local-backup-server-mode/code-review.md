# Brooks-Review — Code: 07 local backup in server mode

## Score: 97 / 100

No decay risks or design smells found. The implementation is minimal, matches
the reviewed plan exactly, and passes 61 tests with a clean TypeScript build.

---

## Observations (informational, no action needed)

### O1 — Extra HTTP round-trip per mutation is intentional

`backupTasksLocally` makes a second `GET /api/tasks` on every mutation.
This is the correct design; mirroring individual mutations locally would
duplicate tasks or misalign IDs (documented in plan). Accepted cost.

### O2 — `async` conversion does not change local-mode semantics

The six functions changed from synchronous-return to `async`. In the local
path, `return invoke(...)` inside an `async` function still returns the same
`Promise<Task>` — async does not double-wrap an already-promised value.
TypeScript's return-type inference confirms this. No behavior change.

### O3 — `fetch(url, undefined)` vs `fetch(url)` in backup call

`httpFetch(path, undefined)` propagates `undefined` as the second argument to
`fetch`. Per the Fetch spec, `fetch(url, undefined)` is identical to
`fetch(url)`. The URL-assertion test correctly ignores this argument.

### O4 — `[[TASK]]` notation in tests

The double-bracket notation (`makeFetchSeq([TASK], [[TASK]])`) is non-obvious;
it is explained by an inline comment. Acceptable for a private test helper.

---

## What is correct and should be kept

- Private helpers not exported — callers cannot bypass the best-effort policy.
- `console.warn` rather than silent swallow — observable in DevTools and logs.
- All 6 mutating functions covered; read functions and `onChange` unchanged.
- 10 new tests: per-function assertions, URL exactness, failure isolation,
  empty-list edge case.
- No Rust changes, no component changes, single-file scope.

---

## Review plan

No findings require implementation. No further iteration needed.
