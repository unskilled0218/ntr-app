# Development

- [Toolchain and dependency updates](#toolchain-and-dependency-updates)
- [Checks](#checks)

## Toolchain and dependency updates

Use Node `^22.22.2 || ^24.15.0 || >=26.0.0` and the platform's Tauri development libraries. The dependency refresh was validated on Node 26.13.0 and Rust 1.100.0. Linux needs pkg-config, DBus, GLib, GTK, and WebKitGTK development packages.

Use `npm ci`. After dependency changes, run full and production-only audits; neither Cargo resolution nor successful tests replace `cargo audit`. Do not force incompatible upgrades or weaken assertions. Keep [native compatibility pins](stack.md#native-compatibility-pins).

## Checks

From the app directory:

```sh
npm ci
NODE_OPTIONS=--no-experimental-webstorage npm test
npm run build
npm run test:release
npm run test:task-contract
npm run test:ha-contract
./scripts/release.sh --validate
git diff --check
```

The Node option lets jsdom own `localStorage` on Node 26. From `src-tauri/`, run `cargo test --locked` and `cargo clippy --locked --all-targets -- -D warnings`.

Contracts use the real serializer and disposable local/HTTP/HTTPS/WSS backends. They require the sibling `../server` or `NTR_SERVER_SOURCE`, Rust, Python 3, OpenSSL, and native build prerequisites. Use `TMPDIR=/tmp/opencode` in the agent container. Set `OLD_NTR_SERVER_BIN` only for separately prepared older-server checks; otherwise those checks are explicitly skipped. Use separate Cargo targets for old source.

Tests do not prove device behavior or live HA compatibility. No-argument publication is not a check; see [publication](forgejo-publishing.md).
