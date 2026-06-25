# Brooks-Lint Review

**Mode:** PR Review
**Scope:** task 19 changes (production: src/style.css; version bumps in package.json, tauri.conf.json, Cargo.toml, Cargo.lock)
**Health Score:** 99/100

A faithful, single-file implementation of the approved plan: the `env()` token is
named once in `:root` with a `0px` fallback and consumed only at the three
screen-edge elements (`main`, `.settings-btn`, `.bottom-nav`). Off-device every
`max()`/`calc()` collapses to the original values, so non-Android layout is
byte-identical. ~25 lines of CSS; per scope calibration, Steps 1-3 are the focus.

---

## Findings

### 🟢 Suggestion

**R4 Accidental Complexity — four inset variables when portrait phones use only top/bottom**
- Symptom: `--safe-left` / `--safe-right` are defined and threaded through `main`'s
  horizontal padding and `.settings-btn`'s `right`, though the common portrait
  case only exercises the top and bottom insets.
- Source: Fowler — *Refactoring*, Speculative Generality; Brooks — *The Mythical
  Man-Month*, Conceptual Integrity.
- Consequence: a few CSS declarations that are a no-op on most devices.
- Remedy: keep it. Landscape display cutouts (notched phones rotated, foldables)
  produce real non-zero left/right insets, and `env(..., 0px)` collapses cleanly
  where they do not, so the symmetric four-variable form costs nothing off the
  cutout and reads more honestly than an asymmetric "top/bottom only" set. This is
  conceptual integrity, not over-abstraction. Accepted, not a blocker.

## Notes (checked, no finding)

- **Mixed `max()` (main padding) vs `calc()` (settings button)** — intentional and
  commented inline at each site: the gutter must not stack a second margin on the
  bar depth (`max`), while the floating chip should keep its full gap below the bar
  (`calc(inset + gap)`). Not a conceptual-integrity violation.
- **No automated test** (Step 7) — the change adds no production *logic*; it is
  declarative CSS reading `env()`, which jsdom does not resolve or lay out. A test
  could only restate the stylesheet (a change-detector). Verification is build +
  device, as planned. No Coverage Illusion finding.
- **Single file, single concern** — no change propagation; nothing outside
  `style.css` (plus the mechanical version bumps) was touched.

## Summary

99/100, over the 95 bar — no iteration needed on the implementation. The
structural calls are right: prerequisites confirmed already-present so the diff
stays one CSS file, the `env()` token single-homed, and the bottom edge owned by
exactly one element per layout (desktop `main`, mobile `.bottom-nav`). The lone
note (four-variable symmetry) is a deliberate stop at conceptual integrity.
