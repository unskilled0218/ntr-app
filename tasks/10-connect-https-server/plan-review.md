# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/10-connect-https-server/plan.md (design plan, pre-implementation)
**Health Score:** 93/100

A well-targeted, conceptually-integral design; one long-parameter-list smell and two
minor issues keep it just under the bar.

---

## Findings

### 🟡 Warning

**Cognitive Overload — `server_fetch` long parameter list**
Symptom: The proposed command takes six parameters (`state`, `url`, `method`, `body`,
`content_type`, `allow_invalid_cert`); five are request data. `server_connect` repeats
the `url` + `allow_invalid_cert` pair. The Step-3 threshold (> 4 params) is exceeded.
Source: Fowler — Refactoring, Long Parameter List.
Consequence: Every future connection option (auth token, timeout, custom CA) widens both
command signatures and every TS call site — an orthogonality leak: a connection concern
forces edits across the transport boundary.
Remedy: Introduce a single `ServerRequest { url, method, body, content_type }` struct
deserialized from one Tauri command arg, and carry the cert policy as its own small typed
unit reused by both `server_fetch` and `server_connect`, so adding an option touches one
struct, not five positions.

### 🟢 Suggestion

**Accidental Complexity — client cache keyed by the cert flag**
Symptom: `AppState.http_client: Mutex<Option<(bool, reqwest::Client)>>` with rebuild-on-flip
logic, for an app that issues a handful of low-frequency requests.
Source: Ousterhout — A Philosophy of Software Design, Ch. 3 (tactical vs strategic); McConnell
— Code Complete Ch. 5 (YAGNI).
Consequence: A small piece of stateful caching logic to maintain and test, whose payoff
(connection pooling) is marginal at this request volume; the tuple `(bool, Client)` also
encodes the cache key implicitly.
Remedy: Either keep it but state the concrete justification (the backup path fires two calls
back-to-back per mutation, so pooling is used), or drop the cache and build the client per
request behind one `build_client(cert_policy)` helper. Pick one and record the reason.

**Cognitive Overload — dropped `statusText` weakens error parity**
Symptom: `serverFetch` throws `new Error(\`${res.status}\`)`, where today's `httpFetch`
throws `\`${res.status} ${res.statusText}\``.
Source: Winters et al. — Software Engineering at Google, Ch. 1 (Hyrum's Law: observable
error text is a de-facto contract).
Consequence: Error toasts lose the human-readable reason ("Not Found"), a silent UX
regression not covered by the tests (which only assert the numeric substring).
Remedy: Return `status` + a `status_text` (reqwest `StatusCode::canonical_reason`) from
`server_fetch` and reconstruct the same `"<status> <statusText>"` message.

---

## Summary

The design's core is sound and its biggest strength — unifying server and local mode on the
single `listen(CHANGE_EVENT)` seam — actively improves conceptual integrity (Brooks Ch. 4),
so the Rust dependency direction stays clean and no cycles are introduced. The one change
worth making before implementation is collapsing the `server_fetch` argument list into a
request struct; folding in the two suggestions then clears 95.

---

# Brooks-Lint Review — Pass 2 (revised plan)

**Mode:** PR Review
**Scope:** tasks/10-connect-https-server/plan.md (revised)
**Health Score:** 97/100
**Trend:** 93 → 97 (+4)

All three prior findings are resolved.

## Findings

### 🟢 Suggestion

**Knowledge Duplication — cert policy named in two command surfaces**
Symptom: `allow_invalid_cert` appears both as a `ServerRequest` field and as a separate
`server_connect` parameter.
Source: Hunt & Thomas — The Pragmatic Programmer, DRY.
Consequence: Negligible today (one `bool`, single-sourced from `getAllowInvalidCert()`);
noted only so it stays a single primitive and does not grow a second meaning.
Remedy: Acceptable as-is — wrapping one `bool` in a shared newtype would be Accidental
Complexity in the other direction. Leave inline; revisit only if a second cert option appears.

## Resolution of Pass-1 findings

- 🟡 Long parameter list → **resolved**: `server_fetch` now takes one `ServerRequest` struct;
  a new connection option widens one type, not five positions.
- 🟢 Client cache complexity → **resolved**: kept, with the concrete reason recorded (the
  back-to-back `POST`+`GET /api/raw` backup path reuses the pooled TLS connection).
- 🟢 Dropped `statusText` → **resolved**: `HttpResponse.status_text` carries
  `canonical_reason()`; `serverFetch` rebuilds the exact `"<status> <statusText>"` message.

## Summary

97/100, above the 95 bar. The plan is ready to implement: transport unified on one event
seam, dependency direction clean, error parity preserved, and the only residual item is an
intentionally-left primitive. Proceed to implementation.
