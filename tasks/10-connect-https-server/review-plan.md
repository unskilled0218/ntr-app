# Plan to address code-review findings

Code review scored 98/100 (above the 95 bar). Two 🟢 Suggestions; one is applied,
one is consciously deferred.

## 1. Remove the `eprintln!` from `run_sse` (apply)

**Finding:** the only logging call in the Rust backend; breaks the silent
best-effort convention `watch.rs` establishes (`let _ = ...`).

**Change:** in `src-tauri/src/http.rs`, the connect-error arm of `run_sse` returns
without logging:

```rust
let res = match client.get(&url).send().await {
  Ok(r) => r,
  Err(_) => return, // best-effort, like the file-watcher; reconnect via re-subscribe
};
```

**Risk:** none. The stream-read error arm already `break`s silently; this makes the
connect arm consistent. No test depends on the log line. Reconnect is unchanged
(frontend `connectionKey` re-subscribe).

## 2. SSE UTF-8 boundary robustness (defer)

**Finding:** `from_utf8_lossy` per chunk could corrupt a multibyte char split across
reads.

**Decision: defer.** The server's `change` stream is ASCII by contract
("tasks"/"note" + SSE framing), so there is no live bug; buffering raw bytes to
decode only whole lines would add complexity for a case that cannot occur with the
current wire format. Recorded here so it resurfaces if the event payload ever
carries non-ASCII. (Matches the "don't add accidental complexity" principle the
finding itself cites.)

## Verification after the change

- `cd src-tauri && cargo test` green; `cargo clippy --all-targets` clean.
- No frontend change, so `vitest` / `tsc` are unaffected.

---

## Brooks-Lint review of this fix-plan

**Health Score: 100/100.** The plan removes a conceptual-integrity finding by deleting one
line to match the existing `let _ =` convention, and explicitly declines to add buffering
complexity for an impossible-by-contract case — so it introduces no new decay risk on any of
the six axes. Above the 95 bar; proceed to implement.
