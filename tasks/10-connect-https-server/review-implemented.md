# Review findings — implemented

From `code-review.md` (98/100) via `review-plan.md` (fix-plan 100/100).

- **Applied:** removed the `eprintln!` connect-failure log from `run_sse` in
  `src-tauri/src/http.rs`; the connect arm now `return`s silently, matching the
  file-watcher's best-effort `let _ =` convention. Reconnect is unchanged.
- **Deferred (documented):** SSE `from_utf8_lossy` per-chunk decoding. No live bug
  — the `change` stream is ASCII by contract; buffering raw bytes would add
  complexity for an impossible case. Recorded in `review-plan.md` for the future.

## Verification

- `cargo test` — 35 passed; `cargo clippy --all-targets` — clean.
- No frontend change; `vitest` (88) and `tsc`/`vite` build remain green from the
  feature commit.
