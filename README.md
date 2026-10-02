# my-ntr — Tauri desktop client

A local-first desktop client for [my-ntr-server](../server/README.md), built with Tauri + React + TypeScript. Stores tasks and notes in local files by default, or connects to a running `my-ntr-server` instance over HTTP.

## Features

- **Note pane** — single Markdown editor with in-place live preview, auto-save, and conflict detection when the file changes elsewhere
- **Todo pane** — add, complete, edit, and delete tasks; filter by status, project, and context; sort by priority, due date, created date, or alphabetically
- **Local-first** — reads and writes `todo.txt` / `Note.md` directly via Tauri commands; no server required
- **Server mode** — switch to a remote `my-ntr-server` via the settings button (`[L]`/`[S]` top-right); all calls go through the server's HTTP API + SSE live updates
- **Live sync** — file-watcher (local) or SSE stream (server) pushes changes to open panes without a reload
- **Mobile layout** — single-pane view with bottom nav and horizontal swipe on narrow screens

## Run

```sh
npm install
npm run tauri dev
```

Data files default to the Tauri app-data directory (`todo.txt` and `Note.md`). In server mode the files live wherever the server stores them.

## Connect to a server

Click the `[L]` button in the top-right corner, enter the server URL (e.g. `http://127.0.0.1:8080`), and click **Connect**. The badge changes to `[S]`. Click it again and choose **Use local files** to switch back.

## Development

```sh
npm run dev          # Vite dev server only (no Tauri shell)
npm run tauri dev    # full Tauri dev build with hot-reload
npm run build        # tsc + vite build (frontend only)
npx vitest run       # unit tests
cd src-tauri && cargo test      # Rust tests
cd src-tauri && cargo clippy --all-targets
```

## Release builds

```sh
scripts/build-release.sh           # desktop + android
scripts/build-release.sh android   # android only
```

Artifacts land in `release/<version>/{desktop,android}/`.

### Publish a Forgejo release

The release command requires a clean `main` checkout. It pushes `main`, runs the tests, builds the requested artifacts, creates the `v<version>` Git tag and Forgejo release for `ntr/ntr-app`, and uploads each artifact with a SHA-256 file. With no target argument it builds and uploads both desktop and Android artifacts:

```sh
install -d -m 700 "$HOME/.config/forgejo"
umask 077
read -rsp "Forgejo token: " token
printf '%s' "$token" > "$HOME/.config/forgejo/forgejo-token"
unset token

FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" scripts/release.sh
FORGEJO_TOKEN="$(<"$HOME/.config/forgejo/forgejo-token")" scripts/release.sh desktop
```

Create the access token under Forgejo **Settings -> Applications -> Access Tokens** with repository-write permission. Keep it outside the repository and ensure the token file has mode `600`. Set `FORGEJO_API_URL` only when publishing to a different Forgejo API endpoint.

### Android signing

A release APK/AAB must be signed or Android refuses to install it on a real device ("App not installed" / `INSTALL_PARSE_FAILED_NO_CERTIFICATES`). Create a signing keystore once:

```sh
scripts/android-keystore.sh        # prompts for a keystore password
```

This writes `src-tauri/gen/android/release.keystore` and `keystore.properties` (both gitignored). After that, `tauri android build` produces a signed `app-universal-release.apk` you can install via `adb install` or by copying it to the device. Back up `release.keystore`: losing it means you can no longer ship updates to the same app. Without the keystore the build still runs but emits an unsigned, non-installable APK.

## Stack

- [Tauri v2](https://tauri.app) — desktop shell, file I/O commands, file-watcher events
- React 18 + TypeScript — UI
- Vite — bundler
- Vitest + jsdom — unit tests
