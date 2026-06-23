# 02 - Review implementation notes

Applied both Suggestions from the 98/100 code review. Changes are comment-only in `App.tsx`.

## Changes

1. `useState(0)` comment: replaced the generic inline comment with a precise one explaining
   that bumping the counter forces the `onChange` useEffect to re-subscribe with the new transport.

2. `eslint-disable-line` comment: replaced the bare suppression with an explanation —
   `// onChange is module-stable; refs excluded by React convention` — so a future reader
   understands this is deliberate, not lazy, and won't try to "fix" it by adding deps.

## Verification

- `npx vitest run` → 42 passed (unchanged).
