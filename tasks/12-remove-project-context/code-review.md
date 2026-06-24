# Brooks-Lint Review

**Mode:** PR Review
**Scope:** branch changes vs main — production: `src/labels.ts`,
`src/components/{FilterBar,RemoveLabelDialog,TodoPane}.tsx` (+ test files).
Skipped: `package*.json`, `Cargo.*`, `tauri.conf.json` (version/lock bumps),
`.brooks-lint-history.json`, `tasks/**` docs — generated/config, not logic.
**Health Score:** 94/100

The implementation matches the approved plan: pure `removeLabel`/`planLabelRemoval`,
a `ConflictDialog`-shaped confirm, a filter-row trigger, and thin TodoPane glue.
Two issues — the orchestration glue is untested, and a button nests inside a
`<label>` — keep it just under the bar.

---

## Findings

### 🟡 Warning

**Coverage Illusion — the `confirmRemove` orchestration has no executing test**
Symptom: `removeLabel` and `planLabelRemoval` are well unit-tested, but
`TodoPane.confirmRemove` — fetch the full list, loop `updateTask` over the plan,
then reload, with a `catch` that also reloads — is exercised by no test (TodoPane
has no test file). The new behavior that actually wires the pure decision to the
store is unverified.
Source: Feathers — Working Effectively with Legacy Code, Ch. 1 (behavior without
a test can change silently); Osherove — The Art of Unit Testing (test the unit of
behavior, not only the leaf helpers).
Consequence: A regression in the glue — wrong argument to `updateTask`, dropping
the reload, calling on the filtered list instead of the full list, or losing the
error-path reload — would pass CI. The plan's "pure helper + thin glue, so no
component test" reasoning holds for the *decision*, but the wiring (loop count,
which list, reload-on-error) is real, testable behavior.
Remedy: Add `src/components/TodoPane.test.tsx` that mocks `../api` and asserts the
glue: opening the dialog and confirming calls `updateTask(id, strippedText)` once
per affected task (and not for unaffected tasks), then `listTasks` is re-queried
(reload). Mirror the existing `EditTaskModal.test.tsx` api-mock style.

### 🟢 Suggestion

**Cognitive Overload — Remove button nested inside the filter `<label>`**
Symptom: In `FilterBar.tsx` the new `<button>` sits inside the same `<label>` that
wraps the `<select>` (e.g. the Project `<label>` now contains the word "Project",
the `<select>`, and the Remove `<button>`). A `<label>` is meant to caption one
control; nesting a second interactive control (a labelable `<button>`) inside it
is structurally surprising.
Source: McConnell — Code Complete, Ch. 7 (least-surprising structure); the button
carries its own `aria-label`, so this is semantics/clarity, not a live a11y break.
Consequence: A reader (or a future a11y audit) has to reason about which control
the `<label>` captions; the implicit association still resolves to the first
labelable descendant (the select), but the intent is muddier than it needs to be.
Remedy: Render the Remove button as a sibling after the `<label>` rather than
inside it, keeping the label captioning only its `<select>`. Visual grouping is
unchanged (both still sit in the same `#filters` fl. row).

---

## Summary

The highest-leverage fix is a small `TodoPane.test.tsx` pinning the
`confirmRemove` wiring, since that is the one piece of new behavior with no
executing test. The button-in-`<label>` nit is a quick structural tidy. Both are
low-risk and self-contained.
