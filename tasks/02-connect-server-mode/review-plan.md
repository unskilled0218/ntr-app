# 02 - Code review plan

brooks-review scored 98/100 (two Suggestions). Both are in `App.tsx`.

## Fix 1: `connectionKey` → add explanatory comment

The rename to `subscriptionTick` would ripple through `onSettingsClose`, the useEffect dep, and
`setConnectionKey` — too much churn for a one-Suggestion fix in a small file. A comment on the
`useState` line is sufficient and matches the codebase style (comments explain WHY, not WHAT).

Change in `App.tsx`:
```ts
// Before:
const [connectionKey, setConnectionKey] = useState(0);

// After:
// Bumped on settings close to force the onChange useEffect to re-subscribe with the new transport.
const [connectionKey, setConnectionKey] = useState(0);
```

## Fix 2: eslint-disable comment — add reason

Change in `App.tsx`:
```ts
// Before:
}, [connectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

// After:
}, [connectionKey]); // onChange is module-stable; refs excluded by React convention
```

## Files changed

`src/App.tsx` only (two comment-only lines).
