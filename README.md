# my-ntr

- [Quick start](#quick-start)
- [Documentation](#documentation)

A desktop and Android app for tasks and Markdown notes. Use local storage or connect to ntr server.

Version `0.15.37`. See [release notes](docs/releases/0.15.37.md).

## Quick start

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and the platform's Tauri development libraries. From this directory:

```sh
npm ci
npm run tauri dev
```

Open connection settings with `[L]` or `[S]`. HA credentials belong on the server, never in the app.

## Documentation

- [Features](docs/features.md), [running and storage](docs/run.md), and [task editing](docs/task-text.md).
- [Lists](docs/project-renaming.md), [server connections](docs/server-connection.md), and [live sync](docs/live-sync.md).
- [Modal styling](docs/modal-styling.md), [development](docs/development.md), and [stack](docs/stack.md).
- [Builds](docs/release-builds.md), [Forgejo publication](docs/forgejo-publishing.md), and [Android signing](docs/android-signing.md).
