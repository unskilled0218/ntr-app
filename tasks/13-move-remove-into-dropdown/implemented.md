# 13 - Move the Remove button inside the dropdown — implemented

Implements `plan.md` (plan-review round 1: 98/100). Version bumped 0.3.0 → 0.3.1
(UI refinement — an existing control is relocated, no new feature; patch on the
0.x line) across `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock`.

## Changes

- **`src/config.ts`** — new `REMOVE_VALUE = "remove label"` const beside
  `ADD_VALUE`. Recognised by exact value; collision-proof because label names
  forbid whitespace (`parseLabelInput`) and this value contains one.
- **`src/components/FilterBar.tsx`** — the two standalone **Remove** buttons are
  gone. Each of the Project and Context selects now:
  - branches in `onChange`: a `REMOVE_VALUE` selection calls `onRemove(kind, name)`
    for the currently-selected label and does not call `onProject`/`onContext`,
    so the controlled value is never replaced by the sentinel;
  - renders a trailing `Remove {prefix}{name}` option only while a concrete label
    is selected — absence is the guard that replaces the old `disabled` button.
  The `onRemove` prop is unchanged. A header comment records that `onRemove` only
  opens the confirm dialog, so an accidental keyboard-arrow selection is harmless.
- **`src/components/TodoPane.tsx`** — unchanged. It still passes `onRemove` and
  renders `RemoveLabelDialog`; the trigger moving inside the select is invisible
  to it.

No backend, HTTP, or CSS change beyond the version strings. `labels.ts`
(`removeLabel`/`planLabelRemoval`), `RemoveLabelDialog`, and the removal
orchestration are all untouched — only the trigger moved.

## Tests

- **`src/components/FilterBar.test.tsx`** — rewritten "remove option" describe:
  no Remove button exists; the Remove option is absent on "All"; selecting the
  sentinel for a concrete project/context fires `onRemove` (and not `onProject`);
  a normal selection still calls `onProject` and not `onRemove`.
- **`src/components/TodoPane.test.tsx`** — the two removal-glue tests now trigger
  removal via the in-dropdown sentinel (a second `change` to `REMOVE_VALUE`)
  instead of clicking the old button. Asserted glue unchanged.
- `labels.test.ts` and `RemoveLabelDialog.test.tsx` untouched — that logic did
  not change.

## Verification

- `npm test` — 110 passed (15 files).
- `npm run build` (tsc + vite) — type-checks and builds clean.
