# 11 - Add a project / context from the app — implemented

## What changed

`src/components/AddForm.tsx` — `LabelModal` is now a React **sibling** of
`<form id="add-form">` instead of a child. The component returns a fragment:

```tsx
return (
  <>
    <form id="add-form" ...> ... </form>
    <LabelModal kind={modalKind} onConfirm={onConfirm} onClose={() => setModalKind(null)} />
  </>
);
```

That is the whole fix. React dispatches `submit` along the React component tree,
so while `LabelModal` lived inside the form, pressing "Add" in the label modal
bubbled into `AddForm.submit` — creating a stray task and resetting the
just-picked label (`setProject("")`). As a sibling, the modal's submit can no
longer reach the form. This matches `EditTaskModal` (already a sibling, which is
why only the add form was broken) and the original web UI
(`server/web/index.html`, where `#label-modal` is a top-level sibling of
`#add-form`).

No change to `LabelModal.tsx`, `LabelSelect.tsx`, `EditTaskModal.tsx`,
`src/api.ts`, `src-tauri/`, or `src/style.css`. The portal idea explored in plan
rounds 1–2 was dropped: a portal moves only DOM parentage, while React event
propagation follows the React tree, so it would not have stopped the bubble (see
`plan.md` "Why not a portal" and `plan-review.md` round 3).

## Tests

New `src/components/AddForm.test.tsx` (jsdom + Testing Library, same
`HTMLDialogElement` stub pattern as `EditTaskModal.test.tsx`):

- adding a project from the modal keeps it selected and does not call `onAdd`
  (the reported symptom; with a non-empty description present);
- adding a context from the modal does not call `onAdd` with an empty
  description (the silent-no-op path);
- a normal task add still calls `onAdd` with the composed text and resets.

Verified the first test **fails** on the old nested structure (it called
`onAdd("water plants")`) and passes after the fix, so it is a true regression
guard.

## Verification

- `npx vitest run` — 12 files, 91 tests pass (includes the 3 new).
- `npm run build` (`tsc && vite build`) — clean.

## Version

Bumped `0.2.0` -> `0.2.1` (patch; regression fix) in `package.json`,
`package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json`.
