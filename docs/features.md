# Features

- [Features](#features)

- **Note pane** — Markdown editor with live preview, autosave, and conflict detection. Backspace at a line boundary preserves the preceding Markdown link.
- **Todo pane** — add, edit, complete, reopen, delete, and filter tasks. Sort by file order, due date, created date, or project in either direction.
- **[Project actions](project-renaming.md)** — rename or remove project references without deleting tasks; recover partial operations from a selector.
- **Local-first** — reads and writes `todo.txt` and `Note.md`; no server required.
- **Server mode** — connect using `[L]`/`[S]`; requests and live updates use the server API.
- **[Remote update approval](live-sync.md)** — review remote changes before applying them. Declined updates stay reviewable, and pending note updates pause autosave.
- **Mobile layout** — single-pane view with bottom nav and horizontal swipe on narrow screens
- **Gesture policy** — touch pinch and double-tap page zoom are disabled where supported; desktop Ctrl+wheel and WebKit zoom gestures are suppressed. Ordinary scrolling and keyboard behavior remain available. OS accessibility magnification is separate from page zoom.
- **Desktop window state** — remembers maximized and native fullscreen modes across normal restarts, preserving normal position and size when returning to windowed mode

Priority is not a task feature. Legacy leading tokens remain hidden; `pri:` is ordinary visible, editable text. See [task text and compatibility](task-text.md).
