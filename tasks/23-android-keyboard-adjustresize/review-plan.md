# 23 - Plan to address the code review

The code review (`code-review.md`) scored **99/100** with a single 🟢 Suggestion and no
Critical/Warning. This plan decides it.

## Finding 1 — listener relies on Tauri-internal view wiring (Hyrum's Law) → **keep, documented**

No change. Customizing a generated Tauri host inherently depends on its observable behaviour;
`onWebViewCreate` is the narrowest seam Tauri exposes for "the WebView now exists," and padding
the content view is the standard Android keyboard-inset pattern. The dependency is already made
explicit by the comment on the override, and the failure mode is benign and self-correcting:

- Padding *any* ancestor of the WebView shrinks it, and the content view is an ancestor
  regardless of any intermediate container Tauri might add, so a future wrapper change does not
  break the mechanism.
- The worst realistic regression is "keyboard avoidance silently stops working" — no crash, no
  data risk — and it is caught by the manual device/emulator verification step.

The two alternatives that would remove the dependency both cost more than they return and were
already scoped out in `plan.md`:

- **A JS `visualViewport` listener** would move the logic into the web layer but fire on
  pinch-zoom too (mistaking zoom for a keyboard) and add per-scroll layout work.
- **The `interactive-widget=resizes-content` viewport meta** would be a second, overlapping
  keyboard mechanism layered on the native one.

Accepting the seam is the standard, lowest-risk resolution.

## Actions

- No code change. The single finding is accepted-as-is with rationale recorded here and in
  `code-review.md`.

## Verification

- None required (no code change). The committed implementation already passed `npm run build`
  (ntr@0.12.0) and `npm test` (21 files, 153 tests).
