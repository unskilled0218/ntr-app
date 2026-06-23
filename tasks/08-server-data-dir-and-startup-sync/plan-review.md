# Brooks-Review — Plan: 08 server data dir and startup sync

## Score: 93 / 100

One test-spec gap (F3) and one missing clarification (F1) hold it below 95.

---

## Findings

### F1 — Disconnect path of syncFromServer effect not documented (severity: low)

**Symptom:** The plan says `syncFromServer` is called whenever `connectionKey`
changes — but `connectionKey` is also bumped when the user clicks "Use local
files". The early-return guard (`if (!getServerUrl()) return`) handles this
correctly, but the plan does not mention it.

**Remedy:** Add one sentence: "When the user disconnects, `getServerUrl()`
returns `""` and `syncFromServer` returns immediately — no network calls."

---

### F2 — Test spec for "note failure does not prevent task sync" is ambiguous (severity: moderate)

**Symptom:** The spec says "mock note fetch to fail (non-2xx)" without stating
how. A developer might use `vi.fn().mockRejectedValueOnce` (network error) which
tests a different code path than an HTTP 4xx (which is thrown by `httpFetch`'s
`!res.ok` check).

**Consequence:** The test could pass while missing the actual 4xx throw path
that production code exercises.

**Remedy:** Pin the spec to `makeFetchSeq([null, 404], [[TASK]])` — first call
returns 404 (triggers `httpFetch`'s throw), second call returns `[TASK]` for the
task sync. Assert `invoke("put_raw", ...)` was still called.

---

## What is correct and should be kept

- Feature 1 scope: one file, one condition removed — minimal.
- Feature 2 scope: one new exported function, one four-line effect — minimal.
- `syncFromServer` independent try/catch blocks — note failure cannot cancel
  task sync.
- Reuse of trailing-newline raw-text formula from task 07 — consistent.
- No Rust changes.

---

## Required changes before implementation

1. Add disconnect-path clarification to the `connectionKey` effect description (F1).
2. Pin the isolation-test spec to `makeFetchSeq([null, 404], [[TASK]])` (F2).
