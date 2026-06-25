# 19 - Plan to address the code review

The code review (`code-review.md`) scored **99/100** with one 🟢 Suggestion and no
Critical/Warning. This plan decides it.

## Finding 1 — four inset variables (incl. left/right) → **keep, documented**

No change. The symmetric `--safe-top/right/bottom/left` set is the
conceptually-integral form: landscape display cutouts (notched phones rotated,
foldables) produce real non-zero left/right insets, and `env(..., 0px)` collapses
to nothing where they do not — so the horizontal variables cost zero off the
cutout while keeping the inset family readable as one named whole. An asymmetric
"top/bottom only" set would save two no-op declarations at the price of a reader
having to ask "why are left/right missing?". Stopping at the full family is the
deliberate boundary, short of both over-abstraction and asymmetric surprise.

## Actions

- No code change. The single finding is accepted-as-is with rationale recorded
  here and in `code-review.md`.

## Verification

- None required (no code change). The committed implementation already passed
  `npm run build` (ntr@0.8.0) and `npm test` (20 files, 145 tests).
