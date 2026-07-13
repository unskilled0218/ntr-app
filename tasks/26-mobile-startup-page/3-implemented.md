# 26 - Implemented

## Summary

- Added `StartupView` preference storage with `ntr.startupView`, defaulting to `note` by omitting the key.
- Added `ntr.lastView` cache storage that records every selected concrete view, including `note`.
- Seeded `App` mobile `view` from the startup preference on mount, resolving `last` through the cached last view.
- Persisted user-driven view changes from bottom-nav clicks and mobile swipes through one `selectView` helper.
- Added a `Startup page` picker to the Settings modal Display section with `Note`, `Todo`, and `Last opened` options.
- Added settings and modal tests for the new preference and last-view cache behavior.
- Bumped app version from `0.14.0` to `0.15.0` in npm, Tauri, and Cargo metadata.

## Verification

- `npm test` passed: 24 files, 196 tests.
- `npm run build` passed.
