# Android signing

Run commands from the app repository root.

A release APK/AAB must be signed or Android refuses to install it on a real device ("App not installed" / `INSTALL_PARSE_FAILED_NO_CERTIFICATES`). Create a signing keystore once:

```sh
scripts/android-keystore.sh        # prompts for a keystore password
```

This writes `src-tauri/gen/android/release.keystore` and `keystore.properties` (both gitignored). After that, `tauri android build` produces a signed `app-universal-release.apk` you can install via `adb install` or by copying it to the device. Back up `release.keystore`: losing it means you can no longer ship updates to the same app. Without the keystore the build still runs but emits an unsigned, non-installable APK.
