# 23 - Android on-screen keyboard: adjustResize (resize the web content above the keyboard)

## Goal

On Android the app runs edge-to-edge in a single WebView (`MainActivity.enableEdgeToEdge()`,
MainActivity.kt:8; task 19). When the soft keyboard opens it draws *over* the page: the
bottom nav and the todo add-form sit under the keyboard and the note caret can fall behind
it. Make the web content **resize** to stay above the keyboard — the Android `adjustResize`
behaviour — so the visible UI always ends at the top of the keyboard.

The fix is entirely in the Android host (the generated, git-tracked, user-editable
`AndroidManifest.xml` and `MainActivity.kt`); no React, CSS, or Rust change is needed.

## The single idea: shrink the WebView by the keyboard inset; the existing CSS reflows for free

The app frame is already a fixed-height flex column that fills the WebView:
`main { height: 100dvh }` (style.css:59), with the bottom nav as its last child and each
pane a flex column whose `flex: 1` region (the task list / the note editor) absorbs any
height change. So **if the WebView itself becomes shorter by the keyboard's height, every
required behaviour falls out of the layout that already exists** — `100dvh` equals the
WebView's (smaller) height, the column re-lays-out, the bottom nav and add-form ride up,
and the `flex: 1` scroll regions shorten. There is nothing per-view to write.

The only missing piece is therefore *making the WebView actually shorter when the keyboard
opens*. That is the one new mechanism this task adds.

### Why the WebView does not already shrink — and the two-part native fix

With edge-to-edge, `enableEdgeToEdge()` calls `WindowCompat.setDecorFitsSystemWindows(window,
false)`: the window is laid out full-screen and the system delivers the keyboard as a
**WindowInset** (`Type.ime()`) instead of resizing the window. So two things are needed:

1. **Tell the window to operate in resize mode for the IME** — set
   `android:windowSoftInputMode="adjustResize"` on the `<activity>` (AndroidManifest.xml:13-18).
   This is what makes the IME inset be *dispatched* (the default, `adjustPan`/unspecified,
   pans or does nothing instead). Necessary but, under `decorFitsSystemWindows=false`, not
   sufficient on its own — it no longer shrinks the window.

2. **Apply the IME inset as bottom padding on the WebView's parent** — in `MainActivity`,
   install one `OnApplyWindowInsetsListener` on the content view (`android.R.id.content`, the
   `FrameLayout` Tauri makes the WebView a child of) that reads the `ime()` bottom inset and pads
   that view's bottom by it. Padding the parent lays the WebView out in the reduced area, so the
   CSS viewport that `100dvh` reads becomes shorter by exactly the keyboard height. Keyboard
   closed → inset is `0` → zero padding → today's layout, byte-for-byte.

Together these *are* "adjustResize" for an edge-to-edge WebView: (1) restores the dispatch
the mode name promises, (2) re-applies the shrink that `decorFitsSystemWindows=false` took
away, at the WebView rather than the whole window.

## The implementation

### 1. `src-tauri/gen/android/app/src/main/AndroidManifest.xml`

Add `android:windowSoftInputMode="adjustResize"` to the existing `<activity>` element
(AndroidManifest.xml:13-18). One new attribute; the existing `android:configChanges`,
`launchMode`, etc. are untouched. (`configChanges`'s `keyboard|keyboardHidden` are the
*hardware* keyboard config and are orthogonal to the soft-input mode.)

```xml
<activity
    android:configChanges="orientation|keyboardHidden|keyboard|screenSize|locale|smallestScreenSize|screenLayout|uiMode"
    android:launchMode="singleTask"
    android:label="@string/main_activity_title"
    android:name=".MainActivity"
    android:windowSoftInputMode="adjustResize"
    android:exported="true">
```

### 2. `src-tauri/gen/android/app/src/main/java/com/my/ntr/MainActivity.kt`

Attach the inset listener via the `onWebViewCreate` seam `WryActivity` already exposes
(WryActivity.kt: `open fun onWebViewCreate(webView: WebView)`, called once Tauri has created the
WebView), and pad the WebView's parent. Final file:

```kotlin
package com.my.ntr

import android.os.Bundle
import android.view.View
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  // adjustResize for the edge-to-edge WebView: enableEdgeToEdge() stops the window from shrinking
  // for the keyboard, so once Tauri has created the WebView, apply the IME inset as bottom padding
  // on its parent (the content view). That shrinks the WebView's laid-out area, so the CSS layout
  // (`main { height: 100dvh }`) reflows above the keyboard. Insets are returned unconsumed, so the
  // WebView still receives the system-bar insets and task 19's env(safe-area-inset-*) keeps working.
  // The inset is 0 when the keyboard is closed, so the layout is unchanged off-keyboard.
  override fun onWebViewCreate(webView: WebView) {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, ime)
      insets
    }
  }
}
```

Specific decisions, each made once and on purpose:

- **Listener attached via the `onWebViewCreate` hook, on the WebView's parent
  (`android.R.id.content`).** `onWebViewCreate` fires once the WebView exists, so the content view
  is present — no creation-ordering guesswork. Attaching to the content view (not
  `window.decorView`) avoids clobbering any inset listener `enableEdgeToEdge()` or a future Tauri
  version might install on the shared decor. Padding the *parent* rather than the WebView itself
  is deliberate: a listener set on the WebView would replace its own `onApplyWindowInsets`
  handling and could zero the safe-area insets Chromium reads; padding the parent and returning
  the insets unconsumed leaves the WebView's own inset handling intact. `onWebViewCreate` is
  *overridden* in our `MainActivity` subclass — `WryActivity` itself (marked `DO NOT MODIFY`) is
  untouched.
- **Pad by the full `ime().bottom`, return `insets` unconsumed.** Returning the insets
  unconsumed lets the WebView child keep receiving the system-bar insets, so task 19's
  `env(safe-area-inset-*)` handling is untouched. Padding by the *full* keyboard height puts
  the WebView's content bottom exactly at the keyboard's top. (See the safe-area note below for
  the one small, deliberate consequence.)
- **`setPadding`, not the `updatePadding` KTX extension.** `ViewCompat` / `WindowInsetsCompat`
  are in `androidx.core` (already on the classpath via `androidx.activity`, which
  `enableEdgeToEdge` comes from), but `updatePadding` lives in `androidx.core:core-ktx`, which
  is not guaranteed present. `setPadding` is a plain framework `View` call and adds no
  dependency. Left/top/right padding is preserved (read back from the view), so the listener
  only ever touches the bottom.
- **`onCreate` keeps `enableEdgeToEdge()` then `super.onCreate()`** unchanged (task 19); the
  listener lives in `onWebViewCreate`, not `onCreate`.

### Interaction with task 19's safe-area insets (deliberate, documented)

When the keyboard is **closed**, `ime().bottom == 0`, the padding is `0`, and the layout is
identical to today — task 19's `--safe-bottom` nav reserve is the sole bottom mechanism, so
desktop and closed-keyboard mobile are byte-for-byte unchanged.

When the keyboard is **open**, the WebView still receives the system-bar bottom inset (insets
returned unconsumed), so `env(safe-area-inset-bottom)` stays its nav-bar value and the bottom
nav keeps that small reserve — which now sits just above the keyboard rather than above the
gesture bar. This is a harmless few-pixels reserve (the gesture bar is itself behind the
keyboard while it is open), and it keeps the nav buttons from sitting flush against the
keyboard. Consuming the bottom inset to zero it out would re-thread task 19's mechanism
through native code for no real gain, so it is intentionally left as is.

### 3. Version bump (the "Update version" step)

`0.11.0 -> 0.12.0` in the four version homes kept in lockstep by every prior task:
`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`
(the `name = "ntr"` package entry, Cargo.lock:2141-2142).

## Tests

- **No automated test is added.** The change is Android host code (Kotlin + manifest); this
  project's test runner is Vitest over the web layer (`npm test`) and there is no Android
  instrumentation/Kotlin test harness, so there is no place to assert window-inset behaviour —
  the same situation task 19 was in for its native prerequisites. The behaviour is a
  device/emulator concern (IME insets and `100dvh` are not evaluated by jsdom).
- **The existing web suite must stay green and unchanged.** No web file is touched, so all
  current suites pass as-is; the version bump does not affect them.

## Verification

- `npm run build` (tsc + vite) — confirms the web build is unaffected and bundles at
  `ntr@0.12.0`.
- `npm test` — the existing suite (21 files) stays green; no test added or changed.
- Android compile — `MainActivity.kt` uses only already-available `androidx.core.view`
  (`ViewCompat`, `WindowInsetsCompat`) and framework `View.setPadding`, so it compiles within
  the existing Gradle dependency set.
- Manual (device/emulator, the only place this is observable):
  - Todo view: focusing the add-form lifts it (and the bottom nav) above the keyboard; the
    task list shortens rather than the form hiding behind the keyboard.
  - Note view: focusing the editor shrinks it so the caret stays above the keyboard.
  - Closing the keyboard restores the full-height layout exactly.

## Out of scope

- **The VirtualKeyboard-API / `env(keyboard-inset-height)` approach** (the superseded
  `23-android-keyboard` branch) and the `interactive-widget=resizes-content` viewport meta —
  this task is explicitly the native `adjustResize` route; adding either would be a second,
  overlapping keyboard mechanism.
- **Per-view CSS tweaks** — the existing `main { height: 100dvh }` flex column already reflows
  when the WebView shrinks, so no view-specific rule is needed or added.
- **Touching task 19's safe-area model** — the listener leaves system-bar insets unconsumed;
  the safe-area behaviour is unchanged (see the interaction note above).
- **Editing the auto-generated `DO NOT MODIFY` Tauri files** (`WryActivity.kt`,
  `RustWebView.kt`, etc.) — only the user-owned `MainActivity.kt` and `AndroidManifest.xml`
  are changed.
