# 22 - Plan to address the code review

The code review (`code-review.md`) scored **99/100** with a single 🟢 Suggestion and
no Critical/Warning. This plan decides it.

## Finding 1 — settings button inside the "Switch view" nav landmark → **keep, documented**

No change. Placing the self-labelled settings badge in the bottom nav is the
requested design (the user chose the compact-trailing layout), and the button keeps
its own `aria-label="Connection settings"`, so it is always named for assistive tech.
The only imperfection is that the `<nav aria-label="Switch view">` region name does
not enumerate a non-view control among its children.

The two "fixes" both cost more than they return:
- **A second landmark** wrapping the badge (or splitting the bar) would mean the
  `onMobile()` breakpoint oracle — which reads `getComputedStyle(navRef).display`
  (App.tsx:101) — and the edge-to-edge nav styling (margins/padding that cancel
  `main`'s gutter and re-add safe-area insets) would have to be re-threaded onto a
  new wrapper. Real, spread-out complexity for a marginal naming gain.
- **Renaming the nav** (e.g. "View and settings") would make the landmark name vaguer
  for the common case (it is primarily the view switcher) to accommodate one trailing
  control.

The button being clearly self-named is the standard, accepted resolution for "an
extra action in a nav bar." Stopping here is deliberate.

## Actions

- No code change. The single finding is accepted-as-is with rationale recorded here
  and in `code-review.md`.

## Verification

- None required (no code change). The committed implementation already passed
  `npm run build` (ntr@0.11.0) and `npm test` (21 files, 153 tests).
