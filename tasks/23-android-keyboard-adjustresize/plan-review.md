# Brooks-Lint Review

**Mode:** PR Review
**Scope:** tasks/23-android-keyboard-adjustresize/plan.md (round 1)
**Health Score:** 98/100
**Trend:** 100 → 98 (−2) vs the last plan review

A focused, well-reasoned plan: it adds exactly one mechanism (shrink the WebView by the IME
inset) and correctly shows the existing `100dvh` flex column reflows for free. One decision —
*which view the inset listener attaches to* — reaches for a broad, shared surface when the
framework already exposes a precise seam for it.

---

## Findings

### 🟢 Suggestion

**Accidental Complexity — the inset listener targets `decorView` + a lazy `android.R.id.content` lookup when a purpose-built seam exists**
Symptom: The plan installs `ViewCompat.setOnApplyWindowInsetsListener(window.decorView)` and then resolves `findViewById<View>(android.R.id.content)?.let { ... }` *inside* the callback, with a null-guard, specifically to dodge the fact that the content view / WebView are not yet attached at the end of `onCreate`. `WryActivity` already exposes `open fun onWebViewCreate(webView: WebView)` (WryActivity.kt) — a hook called once the WebView exists, designed for host customization.
Source: Ousterhout — A Philosophy of Software Design (pull complexity into the narrowest place; prefer the provided seam over a broad one); Fowler — Refactoring (Message Chains / reaching through `android.R.id.content`).
Consequence: Two avoidable costs. (1) `decorView` is a shared inset surface — `setOnApplyWindowInsetsListener` *replaces* any listener already there, so if `enableEdgeToEdge()` or a future Tauri version installs a decor-level listener, this silently clobbers it; the plan asserts androidx does not, but that is an unverified assumption about generated/library code. (2) The lazy `findViewById` + `?.let` null-guard is defensive complexity that exists only to paper over the timing mismatch the broad target created.
Remedy: Override `onWebViewCreate(webView)` in `MainActivity` (the hook guarantees the view tree exists — no null-guard, no creation-ordering guess) and attach the listener to the WebView's **parent**, `android.R.id.content`, padding *its* bottom by the IME inset and returning `insets` **unconsumed**. Padding the parent shrinks the WebView's laid-out area (so the CSS `100dvh` still reflows), while returning the insets unconsumed leaves the WebView child to receive the system-bar insets through normal dispatch — so Chromium's `env(safe-area-inset-*)` (task 19) keeps working. Do *not* attach the listener to the WebView itself: that replaces the WebView's own `onApplyWindowInsets` handling and risks zeroing the safe-area insets it reads. `enableEdgeToEdge()` + `super.onCreate()` stay as they are.

---

## Summary

The core design is sound and minimal: one inset value drives the whole layout, task 19's
safe-area model is left intact (insets returned unconsumed), no new dependency is added, and
the VirtualKeyboard/`interactive-widget` alternatives are explicitly scoped out. The single
🟢 is to attach the IME-inset listener through the `onWebViewCreate` seam and pad the WebView's
parent (`android.R.id.content`), returning insets unconsumed — removing the `decorView` clobber
risk and the lazy null-guard while preserving the WebView's own `env(safe-area)` handling. Fold
it in and the plan is ready.

---

## Round 2 (re-review after revision)

**Health Score:** 100/100 — No findings.

The plan now installs the listener in `onWebViewCreate` and pads the WebView's parent
(`android.R.id.content`), returning insets unconsumed. This resolves the round-1 finding
end-to-end: the `decorView` clobber risk is gone (a view this code owns is targeted), the lazy
`findViewById` null-guard is gone (the hook guarantees the tree exists), and the WebView's own
`onApplyWindowInsets` — and therefore task 19's `env(safe-area-inset-*)` — is left intact because
the WebView is never the listener target. No new Cognitive Overload, Change Propagation,
Knowledge Duplication, Accidental Complexity, Dependency Disorder, or Domain Distortion. The
plan is ready to implement. (≥ 95 reached — PLAN.md iterate loop complete.)
