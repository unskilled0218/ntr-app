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

## Stack

- [Tauri v2](https://tauri.app) — desktop shell, file I/O commands, file-watcher events
- React 18 + TypeScript — UI
- Vite — bundler
- Vitest + jsdom — unit tests
