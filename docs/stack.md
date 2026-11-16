# Stack

- [Runtime and tooling](#runtime-and-tooling)
- [Native compatibility pins](#native-compatibility-pins)

## Runtime and tooling

- [Tauri v2](https://tauri.app) — desktop shell, file I/O commands, file-watcher events
- React 19.3 + TypeScript 7 — UI and type checking
- Vite 8 + React plugin 6 — bundler and React transform
- Vitest 5 + jsdom 31 — unit/component tests
- Node `^22.22.2 || ^24.15.0 || >=26.0.0` — supported tooling runtime range; dependency refresh validated on Node 26

## Native compatibility pins

The vendored window-state plugin remains pinned to `=2.4.0` to preserve the project's fullscreen/window-state patch. Android filesystem integration remains on 28.4.x; its newer platform-specific major requires separate Android validation. Compatible Tauri/native dependencies are refreshed in `src-tauri/Cargo.lock`; retained pins are not a claim that every crate is latest. Native reqwest 0.13's default TLS backend uses Rustls and platform certificate verification, not the older OpenSSL default.
