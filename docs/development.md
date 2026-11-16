# Development

- [Toolchain and dependency updates](#toolchain-and-dependency-updates)
- [Checks](#checks)

## Toolchain and dependency updates

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0`; the current dependency refresh is validated on Node 26.13.0 and Rust 1.100.0. Install the locked npm graph with `npm ci`. Run both `npm audit` and `npm audit --omit=dev` after updates: a clean production audit does not mean the test/dev toolchain is clean. Do not use forced audit upgrades or bypass peer compatibility. See [the stack and retained native pins](stack.md).

Vitest 5/jsdom 31, Vite 8/React plugin 6, and TypeScript 7 are upgraded together. Preserve behavioral assertions when adapting tests to tool changes: generic fake readers use a typed object plus a spy, and remote-review buttons expose explicit accessible names rather than relying on whitespace across text/span nodes. Refresh native dependencies with Cargo, retain the vendor patch, and run locked native tests where system development libraries are available. `cargo audit` is a separate optional security tool; ordinary Cargo resolution/tests are not a vulnerability audit.

## Checks

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

Run `npm run test:ha-contract` for the real client serializer against the sibling Rust HA adapter and a disposable loopback HTTPS fixture. Requires Rust, Python 3, and OpenSSL; it does not access real HA. On Node 26, run frontend tests with `NODE_OPTIONS=--no-experimental-webstorage npm test` so jsdom owns `localStorage` instead of Node's experimental implementation.

The HA contract also covers explicit/default list routing, a confirmed cross-list move, stable restart identity, and administrative create/rename/delete through the public ntr routes and verified WSS registry transport. `HaProjects.test.tsx` covers list selectors, literal-token preservation, confirmation/cancel, catalog invalidation, and recovery. `haListsTransport.test.ts` checks request bodies and stale destination rejection. Native Linux checks require system development packages, including `pkg-config`, DBus, GLib, GTK, and WebKitGTK; missing packages are environment blockers, not passing native verification.
