# Features

- [Features](#features)

- **Note pane** — single Markdown editor with in-place live preview, auto-save, and conflict detection when the file changes elsewhere; Backspace at a line boundary preserves the preceding Markdown link
- **Todo pane** — add, complete, reopen, edit, and delete tasks; show active and completed tasks with project filtering; sort by file order, due date, created date, or project, ascending or descending
- **[Project actions](project-renaming.md)** — pencil/trash controls in filter and create-task project selectors; rename/remove project references without deleting tasks, manage draft-only choices locally, and recover partial operations through selectors before explicit retry
- **Local-first** — reads and writes `todo.txt` / `Note.md` directly via Tauri commands; no server required
- **Server mode** — switch to a remote `my-ntr-server` via the settings button (`[L]`/`[S]` top-right); all calls go through the server's HTTP API + SSE live updates
- **[Remote update approval](live-sync.md)** — SSE detects remote changes and asks before applying them; declined updates stay reviewable, conflicting note autosaves pause, and reconnect detects missed updates; local file watching stays automatic
- **Mobile layout** — single-pane view with bottom nav and horizontal swipe on narrow screens
- **Gesture policy** — touch pinch and double-tap page zoom are disabled where supported; desktop Ctrl+wheel and WebKit zoom gestures are suppressed. Ordinary scrolling and keyboard behavior remain available. OS accessibility magnification is separate from page zoom.
- **Desktop window state** — remembers maximized and native fullscreen modes across normal restarts, preserving normal position and size when returning to windowed mode

Priority is not a task feature. Legacy leading tokens remain hidden; `pri:` is ordinary visible, editable text. See [task text and compatibility](task-text.md).
