# 23 - Implemented

Implements the plan as refined by `plan-review.md` (listener via the `onWebViewCreate` seam,
padding the WebView's parent and returning insets unconsumed). Android-host-only change: the
edge-to-edge WebView now resizes above the on-screen keyboard (adjustResize).

## `src-tauri/gen/android/app/src/main/AndroidManifest.xml`

Added `android:windowSoftInputMode="adjustResize"` to the `<activity>` so the IME inset is
dispatched. The existing `android:configChanges`, `launchMode`, `label`, `name`, and
`exported` attributes are unchanged.

## `src-tauri/gen/android/app/src/main/java/com/my/ntr/MainActivity.kt`

Overrode `onWebViewCreate(webView)` (the hook `WryActivity` exposes once the WebView exists)
to install one `OnApplyWindowInsetsListener` on the content view (`android.R.id.content`, the
WebView's parent):

```kotlin
override fun onWebViewCreate(webView: WebView) {
  val content = findViewById<View>(android.R.id.content)
  ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
    val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
    v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, ime)
    insets
  }
}
```

Padding the parent shrinks the WebView's laid-out area, so the CSS `main { height: 100dvh }`
flex column reflows above the keyboard (bottom nav + todo add-form ride up; the `flex: 1`
task-list / note-editor shorten). Insets are returned unconsumed, so the WebView child still
receives the system-bar insets and task 19's `env(safe-area-inset-*)` is untouched. The inset
is 0 when the keyboard is closed, so the off-keyboard layout is byte-for-byte unchanged.
`onCreate` keeps `enableEdgeToEdge()` then `super.onCreate()`. Only `androidx.core.view`
(`ViewCompat`, `WindowInsetsCompat`, already on the classpath via `androidx.activity`) and the
framework `View.setPadding` are used — no new dependency.

## Version

Bumped 0.11.0 -> 0.12.0 in `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and the `name = "ntr"` entry in `src-tauri/Cargo.lock`.

## Tests

No automated test added: the change is Kotlin + manifest, and the project's runner is Vitest
over the web layer (there is no Android instrumentation/Kotlin test harness; IME insets and
`100dvh` are not evaluated by jsdom). No web file changed, so the existing suite stays green.

## Verification

- `npm run build` (tsc + vite) — clean; bundles at ntr@0.12.0 (59 modules; CSS 8.03 kB).
- `npm test` — 21 files, 153 tests, all pass (unchanged; no web file touched).
- Manual (device/emulator, the only place this is observable): focusing the todo add-form
  lifts it and the bottom nav above the keyboard with the task list shortening; focusing the
  note editor shrinks it so the caret stays above the keyboard; closing the keyboard restores
  the full-height layout exactly.
