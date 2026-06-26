# Brooks-Lint Review

**Mode:** PR Review
**Scope:** 23-android-keyboard-adjustresize code (round 1) — `src-tauri/gen/android/app/src/main/java/com/my/ntr/MainActivity.kt`, `src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Skipped: version bumps in `package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` (config) and `src-tauri/Cargo.lock` (generated lock file), `.brooks-lint-history.json` (tool artifact).
**Health Score:** 99/100
**Trend:** 100 → 99 (−1) vs the last code review

A clean, minimal implementation that lands the reviewed plan: one manifest attribute plus one
inset listener installed through the framework's own `onWebViewCreate` seam, padding the
WebView's parent and leaving its safe-area handling intact. One nuance — a behavioural
dependency on Tauri's view wiring — is worth recording.

---

## Findings

### 🟢 Suggestion

**Domain Model Distortion (Hyrum's Law) — the listener relies on Tauri-internal view wiring**
Symptom: `onWebViewCreate` resolves `findViewById<View>(android.R.id.content)` and pads it to move the WebView, which assumes (a) Tauri installs the WebView under the standard content view and (b) `onWebViewCreate` runs on the UI thread with that view present (MainActivity.kt:22-29). These are observed behaviours of the generated `WryActivity`, not a documented API contract.
Source: Hyrum's Law (all observable behaviours of a system will be depended upon); Ousterhout — A Philosophy of Software Design (information leakage across a module boundary).
Consequence: If a future Tauri version wraps the WebView in a different container or changes when `onWebViewCreate` fires, the padding could attach to the wrong view or a stale one. The blast radius is small and self-contained: padding *any* ancestor of the WebView still shrinks it (content view is an ancestor regardless of intermediate wrappers), so the realistic failure mode is "keyboard avoidance stops working," not a crash or data issue — and it is caught by the manual device check.
Remedy: Accept as-is (recommended). `onWebViewCreate` is the narrowest seam Tauri offers for "the WebView now exists," and padding the content view is the standard Android keyboard-inset pattern; the alternatives (a JS `visualViewport` listener, or the `interactive-widget` viewport meta) were scoped out in the plan for good reasons. Keep the documenting comment so the dependency is explicit, and rely on the manual device verification step to catch any future Tauri behavioural change.

---

## Summary

Nothing blocks merge. The implementation matches the plan reviewed to 100/100: `adjustResize`
in the manifest restores IME-inset dispatch, the listener is installed via `onWebViewCreate`
(no `decorView` clobber, no null-guard), and padding the WebView's parent while returning
insets unconsumed preserves task 19's `env(safe-area-inset-*)`. No Change Propagation (one
host-only feature), Knowledge Duplication, Accidental Complexity (no new dependency; full
keyboard-height padding is the whole logic), or Dependency Disorder. The single 🟢 is an
accepted Hyrum's-Law trade-off inherent to customizing a generated host; build is clean at
ntr@0.12.0 and the web suite is green (21 files, 153 tests).
