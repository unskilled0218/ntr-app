# 11 - Review-fix plan

Addresses the round-1 code review (`code-review.md`, 96/100). One actionable
finding: the jsdom `<dialog>` polyfill is duplicated across `EditTaskModal.test.tsx`
and `AddForm.test.tsx`.

## Change — one shared test setup for the `<dialog>` polyfill

jsdom does not implement `HTMLDialogElement.prototype.showModal/close`. That is a
property of the **test environment**, not of any one component test, so it
belongs in one place that runs before every test file.

1. **`src/test/setup.ts`** (new) — define the stub once:
   ```ts
   beforeAll(() => {
     HTMLDialogElement.prototype.showModal = function () { this.open = true; };
     HTMLDialogElement.prototype.close = function () {
       this.open = false;
       this.dispatchEvent(new Event("close"));
     };
   });
   ```
   Use `beforeAll` from `vitest` (imported in the setup module) so the behavior
   is byte-for-byte what both test files do today.

2. **`vitest.config.ts`** — add `setupFiles: ["./src/test/setup.ts"]` to the
   `test` block. setupFiles run before each test file, so the prototypes are
   patched in time for every suite.

3. **`src/components/EditTaskModal.test.tsx`** and
   **`src/components/AddForm.test.tsx`** — remove the local `beforeAll` dialog
   stub (and the now-unused `beforeAll` import where it is otherwise unused).
   Everything else in those files is unchanged.

## Why not address the id-scoping suggestion

Keeping `document.getElementById("label-modal" / "add-form")` for test scoping is
the pragmatic choice: the add form and the always-rendered label modal both have
an "Add" button, and the modal needs an unambiguous container to query within.
Role-based scoping (`getByRole("dialog")`) only works while the dialog is open and
would not simplify the form-button case. Left as-is by design; recorded in
`code-review.md`.

## Scope guard

Pure test-infrastructure change. No production code, no behavior change. The fix
is "move identical code to one home", so the assertion is simply that the full
suite stays green afterward.

## Verification

- `npx vitest run` — all 12 files / 91 tests still pass, proving the shared setup
  patches the prototypes for every suite (including the two that lost their local
  stub).
- `npm run build` — unaffected (no production or type change).
