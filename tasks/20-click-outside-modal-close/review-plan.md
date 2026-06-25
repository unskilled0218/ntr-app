# 20 - Plan to address the code review

The code review (`code-review.md`) scored **99/100** with one 🟢 Suggestion and no
Critical/Warning. This plan decides it.

## Finding 1 — backdrop listener re-subscribes per render for the two override callers → **keep, documented**

No change. The effect re-runs only for SettingsModal and EditTaskModal (whose
`onClose` identity can change per parent render), and only swaps a stateless
listener with an exact cleanup — no correctness or perceptible cost. The "fix"
would be to wrap each parent's `onClose` in `useCallback` (in App and the
EditTaskModal owner), pushing memoization machinery outward across files to spare a
cheap, mount-scoped `addEventListener`. That trades real, spread-out complexity for
a negligible gain — the wrong side of the strategic/tactical line. Stopping here is
deliberate.

## Actions

- No code change. The single finding is accepted-as-is with rationale recorded here
  and in `code-review.md`.

## Verification

- None required (no code change). The committed implementation already passed
  `npm run build` (ntr@0.9.0) and `npm test` (20 files, 150 tests).
