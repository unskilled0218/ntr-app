# Brooks-Review — Plan: 07 local backup in server mode

## Score: 87 / 100

The design is minimal and correct. One cross-cutting concern (error
observability) and two test-specification gaps hold it below 95.

---

## Findings

### F1 — Silent catch blocks hide sync failures (severity: moderate)

**Symptom:** Both helpers swallow every exception with an empty `catch {}`.

**Source:** Best-effort policy is implemented as "catch and ignore". No signal
reaches the developer or the operator when local writes consistently fail (e.g.,
because the local data directory is on a read-only filesystem after a system
event).

**Consequence:** A user who relies on the local mirror for fallback discovers
only when switching back to local mode that all writes silently failed for days.
There is no way to diagnose this from the outside.

**Remedy:** Replace the empty catch with `console.warn`. The promise is still
swallowed (best-effort semantic is preserved), but the failure becomes visible
in the DevTools console and in Tauri's log output:

```ts
} catch (e) {
  console.warn("local backup failed:", e);
}
```

---

### F2 — Test specification does not pin the exact backup URL (severity: low)

**Symptom:** The test description says "verify a second fetch was made to
`/api/tasks` (no filter)" without specifying the full expected URL string or
asserting the absence of query parameters.

**Source:** Vague prose leaves the implementer free to write a test that passes
even if the call accidentally includes `?completed=false` (which would miss
completed tasks in the local backup).

**Consequence:** The tests could pass while the local backup silently omits all
completed tasks — exactly the content a user most wants to preserve.

**Remedy:** Tighten the test spec:

> Verify `fetch` was called with `serverUrl + "/api/tasks"` and no query
> string; assert that `invoke("put_raw", ...)` received the joined raw lines of
> all tasks the mock returned.

---

### F3 — "local" in helper name implies no network I/O (severity: low)

**Symptom:** `localSyncTasks` makes an HTTP call to `/api/tasks`, but its name
suggests it only touches local storage.

**Source:** Naming follows the "what we write to" (local store) rather than
describing the full operation (fetch from server, then write locally).

**Consequence:** A future reader of a `createTask` call site will be surprised
to find that a function named "local" performs a second network round-trip.

**Remedy:** Rename to `backupTasksLocally`. The name still explains the
destination without falsely implying the absence of network I/O.

---

## What is correct and should be kept

- Full `put_raw` sync rather than mirroring individual mutations — the
  reasoning around ID collision is sound and well-documented.
- Trailing newline analysis matches the Rust `Display` impl (no newline in
  `raw`, so the join formula is correct).
- `localPutNote` passes text directly rather than re-fetching — avoids an
  unnecessary round-trip since the caller already has the text.
- Scope limited to `src/api.ts` only — no Rust changes, no component churn.
- Best-effort semantic: local failure must not block the server write.

---

## Required changes before implementation

1. Add `console.warn` in both catch blocks (F1).
2. Rename `localSyncTasks` → `backupTasksLocally` (F3).
3. Tighten test specification to pin the exact URL and assert absence of query
   parameters (F2).
