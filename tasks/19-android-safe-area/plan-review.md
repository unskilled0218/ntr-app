# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/19-android-safe-area/plan.md (round 1)
**Health Score:** 99/100 (> 95, passes; no iteration needed)

A tightly scoped plan: it consumes the already-present edge-to-edge +
`viewport-fit=cover` prerequisites with **one** file's worth of CSS, names the
platform token (`env(safe-area-inset-*)`) exactly once as `:root` variables, and
applies it only at the three elements that actually touch a screen edge.

## Findings

### 🟢 Suggestion

**R4 Accidental Complexity — four inset variables when target devices mostly use top/bottom**
- Symptom: the plan defines `--safe-left` and `--safe-right` and threads them
  through `main`'s horizontal padding and `.settings-btn`'s `right`, though the
  common portrait phone case only exercises the top (status bar) and bottom
  (gesture bar) insets.
- Source: Fowler — *Refactoring*, Speculative Generality; Brooks — *The Mythical
  Man-Month*, Conceptual Integrity.
- Consequence: a small amount of CSS that may be a no-op on most devices.
- Remedy: keep it. Landscape display cutouts (notched phones rotated, foldables)
  produce real non-zero left/right insets, and `env(...)` collapses to the `0px`
  fallback where they do not — so the symmetric four-variable form costs nothing
  off the cutout and is more readable than an asymmetric "top/bottom only" set
  that a future reader would have to question. Defining the whole inset family
  once is the conceptually-integral choice, not speculative generality. Accepted,
  not a blocker.

## Resolution applied to the plan

Two points were checked and judged already-resolved in the plan, so no change was
made:

- **Mixed `max()` vs `calc()` for insets** (potential conceptual-integrity snag):
  `main` uses `max(gutter, inset)` while `.settings-btn` uses `calc(inset + gap)`.
  The plan states the reason inline — the gutter must not stack a second full
  margin on top of the bar depth, whereas the floating chip should keep its full
  gap *below* the bar — so the two strategies are intentional and documented, not
  an inconsistency.
- **No automated test** (potential Coverage Illusion, Step 7): pre-empted. The
  change adds no TypeScript; jsdom resolves no layout/`env()`/`max()`, so a test
  could only restate the stylesheet (a change-detector). The plan calls this out
  and points verification at build + device, matching how task 18's pure-CSS
  additions were handled. No finding.

## Summary

99/100, over the 95 bar. Strongest moves: confirming the Android prerequisites are
already present so the change stays a single CSS file (no Kotlin/manifest churn),
naming the `env()` token once in `:root` and consuming it only at edge elements,
and splitting the bottom edge cleanly (desktop -> `main`, mobile -> `.bottom-nav`)
so there is one owner per edge. The lone note (four-variable symmetry) is a
deliberate stop at conceptual integrity, not over-abstraction.
