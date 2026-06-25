# 15 - Remove the focus border — implemented

## What changed

Styling only, in `src/style.css`, exactly as planned.

1. **Added** a global focus-ring reset right after the `* { box-sizing }` reset:

   ```css
   :focus,
   :focus-visible {
     outline: none;
   }
   ```

   with a comment noting `:focus` alone suffices by cascade origin (author beats
   UA) and `:focus-visible` is a defensive belt-and-suspenders selector.

2. **Deleted** the `.note-input:focus { outline: 2px solid var(--accent);
   outline-offset: -1px; }` block — the only explicit focus ring in the app.

No `border` declaration was touched: every resting input/trigger/dialog border
stays, and `.picker-choice[aria-current="true"]` still highlights the selected
row.

## Version

Bumped 0.4.0 -> 0.4.1 in `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml` (`Cargo.lock` already carried 0.4.1).

## Verification

- `npm test` — 17 files, 115 tests pass (no behavioural change; CSS is not
  imported by any test).
- `npm run build` (tsc + vite) — builds clean as `ntr@0.4.1`; CSS bundle emits.
- `grep "focus\|outline" src/style.css` — the only remaining matches are the new
  global reset and its comment; the `.note-input:focus` accent ring is gone.

## Files touched

- `src/style.css` — global focus reset added, `.note-input:focus` removed.
- `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` — version bump.
- `tasks/15-remove-focus-border/{plan,plan-review,implemented}.md` — task docs.
- `.brooks-lint-history.json` — plan round-1 score recorded.
