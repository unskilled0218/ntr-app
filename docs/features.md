# Features

- **Note pane** — single Markdown editor with in-place live preview, auto-save, and conflict detection when the file changes elsewhere
- **Todo pane** — add, complete, reopen, edit, and delete tasks; show active and completed tasks with project filtering; sort by file order, priority, due date, created date, or project, ascending or descending
- **Local-first** — reads and writes `todo.txt` / `Note.md` directly via Tauri commands; no server required
- **Server mode** — switch to a remote `my-ntr-server` via the settings button (`[L]`/`[S]` top-right); all calls go through the server's HTTP API + SSE live updates
- **[Live sync](live-sync.md)** — file-watcher (local) or SSE stream (server) refreshes open panes; automatic reconnect recovers missed task and note changes
- **Mobile layout** — single-pane view with bottom nav and horizontal swipe on narrow screens
- **Desktop window state** — remembers maximized and native fullscreen modes across normal restarts, preserving normal position and size when returning to windowed mode
