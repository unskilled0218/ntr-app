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
  // (main { height: 100dvh }) reflows above the keyboard. Insets are returned unconsumed, so the
  // WebView still receives the system-bar insets and the env(safe-area-inset-*) handling keeps
  // working. The inset is 0 when the keyboard is closed, so the layout is unchanged off-keyboard.
  override fun onWebViewCreate(webView: WebView) {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val ime = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      v.setPadding(v.paddingLeft, v.paddingTop, v.paddingRight, ime)
      insets
    }
  }
}
