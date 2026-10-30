# Development

Run commands from the app repository root.

```sh
npm run dev          # Vite dev server only (no Tauri shell)
npm run tauri dev    # full Tauri dev build with hot-reload
npm run build        # tsc + vite build (frontend only)
npx vitest run       # unit tests
cd src-tauri && cargo test      # Rust tests
cd src-tauri && cargo clippy --all-targets
```

Run the actual client serializer through disk-backed local and HTTP save/reload paths with `npm run test:task-contract`. It builds the local headless example and the sibling `../server` (override with `NTR_SERVER_SOURCE`). Rust/Tauri build dependencies and Node 22+ are required. Set `TMPDIR=/tmp/opencode` when working in the agent container.

Set `OLD_NTR_SERVER_BIN` to a separately built pre-removal server binary to also verify old-server edit compatibility and its completion/reopening conversion limit. Without that variable, the script explicitly reports that old-server checks were not run. Build old source in a separate target directory to avoid stale same-version Cargo artifacts. The runner uses temporary files, starts loopback servers on ephemeral ports, and stops them afterward; it does not touch user task files.
