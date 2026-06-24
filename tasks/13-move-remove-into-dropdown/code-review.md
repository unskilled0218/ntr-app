# 13 - Code review (brooks-review)

## Round 1 — 99/100

**Mode:** PR Review · **Scope:** `config.ts`, `FilterBar.tsx`, `FilterBar.test.tsx`,
`TodoPane.test.tsx` · **Trend:** 94 → 99 (+5) vs the last code review (task 12 r1)

One 🟢 Suggestion, no Critical/Warning. Cleared >95 on round 1.

- **R3 — branch + sentinel duplicated across the project/context selects.**
  Deliberate: FilterBar already fully twins the two selects, and the decision is
  recorded in `plan.md`. Remedy is "keep as-is" — no code change.

### Notable strengths confirmed

- `REMOVE_VALUE` is shared from `config.ts`; the test imports the constant rather
  than re-typing `"remove label"`, so there is no information leakage of the
  sentinel across files.
- `onChange` branches without ever writing the sentinel into the controlled
  `value`, so the select never gets stuck showing the sentinel.
- The in-dropdown option's absence on "All" cleanly replaces task 12's
  disabled-button guard; `onRemove` only opens the confirm dialog, so an
  accidental keyboard-arrow selection is harmless.
- Tests carry regression guards (sentinel does not call `onProject`; a normal
  selection does not call `onRemove`).

## Plan to implement the review

No code findings to act on — the single suggestion is an intentional design
choice with remedy "keep as-is". No re-implementation, no second commit needed.

## Verification (unchanged from implementation)

- `npm test` — 110 passed (15 files).
- `npm run build` — type-checks and builds clean.
