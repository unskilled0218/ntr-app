# my-ntr

- [Quick start](#quick-start)
- [Documentation](#documentation)

A local-first task manager and Markdown notes app built with Tauri, React, and TypeScript. Runs on desktop and Android, using local files or an optional `my-ntr-server` connection.

Version `0.15.33` refreshes React, Tauri dependencies, and the TypeScript/Vite/Vitest toolchain. Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and `npm ci` for the locked dependency graph. See [release notes](docs/releases/0.15.33.md); local validation does not publish anything.

## Quick start

```sh
npm install
npm run tauri dev
```

Tasks and notes are stored in the Tauri app-data directory by default. Use the `[L]` button to connect to a server.

The optional server can use [Home Assistant To-do](docs/server-connection.md#home-assistant-tasks), keeping HA credentials and private-CA trust server-side. Markdown notes remain unchanged.

If the server is unreachable, the app uses local files and keeps the saved URL. Retry with Connect; see [connection safety](docs/server-connection.md).

Review remote changes before applying them; pending note updates pause autosave. See [live sync](docs/live-sync.md). For project actions, input gestures, and legacy priority data, see the links below.

## Documentation

- [Features](docs/features.md)
- [Task text and compatibility](docs/task-text.md)
- [Project renaming](docs/project-renaming.md)
- [Run and data files](docs/run.md)
- [Server connection](docs/server-connection.md)
- [Live sync and note-save safety](docs/live-sync.md)
- [Development and testing](docs/development.md)
- [Release builds](docs/release-builds.md)
- [Forgejo publishing](docs/forgejo-publishing.md)
- [Android signing](docs/android-signing.md)
- [Stack](docs/stack.md)
