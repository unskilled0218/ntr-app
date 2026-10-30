# my-ntr

- [Quick start](#quick-start)
- [Documentation](#documentation)

A local-first task manager and Markdown notes app built with Tauri, React, and TypeScript. Runs on desktop and Android, using local files or an optional `my-ntr-server` connection.

## Quick start

```sh
npm install
npm run tauri dev
```

Tasks and notes are stored in the Tauri app-data directory by default. Use the `[L]` button to connect to a server.

Priority controls, sorting, and filtering are removed in `0.15.18`. Existing leading tokens stay hidden and preserved; `pri:` remains editable text. See [task text and compatibility](docs/task-text.md).

Note recovery preserves newer edits and undo, including a return to empty text, across unchanged server settings. See [note-save safety](docs/live-sync.md#note-save-ownership) for conflict choices and limits.

## Documentation

- [Features](docs/features.md)
- [Task text and compatibility](docs/task-text.md)
- [Run and data files](docs/run.md)
- [Server connection](docs/server-connection.md)
- [Live sync and note-save safety](docs/live-sync.md)
- [Development and testing](docs/development.md)
- [Release builds](docs/release-builds.md)
- [Forgejo publishing](docs/forgejo-publishing.md)
- [Android signing](docs/android-signing.md)
- [Stack](docs/stack.md)
