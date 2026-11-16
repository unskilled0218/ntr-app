# Run

- [Start](#start)
- [Storage](#storage)

## Start

From the app directory, run `npm ci` followed by `npm run tauri dev`. Toolchain requirements and checks are in [development](development.md).

## Storage

Local tasks, notes, and label suggestions use the Tauri app-data directory by default. Server mode uses the selected server's storage. Connection settings and drafts remain separate from saved content.

Back up/export data before uninstalling the app or replacing its Android signing identity. Local fallback is not a guaranteed fresh server backup; see [connection safety](server-connection.md).
