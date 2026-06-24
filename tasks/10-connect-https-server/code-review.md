# Brooks-Lint Review

**Mode:** PR Review
**Scope:** branch `10-connect-https-server` vs main — production: `src-tauri/src/http.rs`
(new), `lib.rs`, `state.rs`, `src/api.ts`, `settings.ts`, `components/SettingsModal.tsx`,
`style.css`; tests: `api.test.ts`, `settings.test.ts`. Skipped: `Cargo.lock` (generated),
`tasks/*.md` (docs).
**Health Score:** 98/100
**Trend:** plan 97 → code 98

A clean implementation that matches its reviewed plan; two low-severity consistency/robustness
notes only.

---

## Findings

### 🟢 Suggestion

**Dependency Disorder — `eprintln!` breaks the codebase's silent best-effort convention**
Symptom: `run_sse` logs a failed connect with `eprintln!("sse connect failed: {e}")`. No
other Rust module logs; the established idiom for a best-effort background failure is
`watch.rs`'s `let _ = ...` (swallow and self-correct on the next tick).
Source: Brooks — The Mythical Man-Month, Ch. 4 (Conceptual Integrity); McConnell — Code
Complete (consistency of error handling).
Consequence: A second, inconsistent error-handling style in a two-file backend; readers can
no longer assume "background tasks fail silently and recover", which the file-watcher relies on.
Remedy: Drop the `eprintln!` and let the task end quietly, matching `watch.rs`. Reconnect
already happens via the frontend's `connectionKey` re-subscribe, so no signal is lost.

**Accidental Complexity — `from_utf8_lossy` per chunk can split a multibyte char**
Symptom: `run_sse` does `buf.push_str(&String::from_utf8_lossy(&bytes))` on each network
chunk; a UTF-8 character split across a chunk boundary becomes a replacement char.
Source: Ousterhout — A Philosophy of Software Design, Ch. 3 (handle the edge in the right place).
Consequence: None today — the server's `change` stream carries only ASCII tokens
("tasks"/"note") and framing — so this is a latent robustness gap, not a live bug.
Remedy: Acceptable as-is for an ASCII control stream; if the event payload ever carries
non-ASCII, buffer `Vec<u8>` and decode only up to the last newline. Deliberately deferred to
avoid adding buffering complexity for a stream that is ASCII by contract.

---

## Summary

98/100, above the bar on the first code pass — the design's "one transport seam, fully in
Rust" held up: public `api.ts` signatures are unchanged, the SSE bridge reuses the existing
`change` event, and the only non-trivial logic (`sse_tokens`) is pure and unit-tested. Apply
the one-line `eprintln!` removal for conceptual integrity; the UTF-8 note is consciously
deferred.
