# 17 - Plan to address the code review

The code review (`code-review.md`) scored **98/100** with two 🟢 Suggestions and
no Critical/Warning. This plan decides what to do about each.

## Finding 1 — `optionLabel` duplication → **fix**

`SelectField` (`selected = options.find(...) ?? options[0]` then `selected?.label
?? ""`) and `SortField` (`labelFor()`) express the same "current option's label,
first-option fallback" rule. This is a genuine, low-risk consolidation that makes
`PickerList` the one home for option-row concerns it already owns the type for.

### Change

In `src/components/PickerList.tsx`, export a tiny helper beside `FieldOption`:

```ts
// The label of the option whose value matches, falling back to the first option's, then "" —
// the text a picker trigger shows for its current selection. One home so SelectField and
// SortField derive their trigger text the same way.
export function optionLabel(options: FieldOption[], value: string): string {
  return (options.find((o) => o.value === value) ?? options[0])?.label ?? "";
}
```

- `SelectField`: import `optionLabel`; replace the `selected` derivation with
  `{optionLabel(options, value)}` on the trigger (the only use of `selected`).
- `SortField`: drop the local `labelFor`; import `optionLabel`; build the summary
  as `` `${optionLabel(sortOptions, sort)} · ${optionLabel(dirOptions, dir)}` ``.

Behaviour is identical — both triggers already showed exactly this — so existing
`SelectField.test.tsx` and `SortField.test.tsx` stay green unchanged. A small unit
test for `optionLabel` (match, fallback-to-first, empty-options → "") is added to
`PickerList.test.tsx` to lock the rule in its new home.

## Finding 2 — picker-shell duplication → **keep, documented**

The `.select-field` trigger + `<dialog>` + open `useEffect` + `.modal-actions`
repeat across `SelectField` and `SortField`. This is **deliberately not** changed:

1. The two shells diverge where it matters — close-on-pick + single value
   (`SelectField`) vs stay-open + `sort · dir` summary + Done (`SortField`). A
   shared shell would have to encode those differences as flags/branches/children,
   turning one clear component into a shallow, parameterized one (the smell to
   avoid: interface complexity approaching body complexity).
2. The open/close `useEffect` specifically is already duplicated by established
   convention across `LabelModal`/`EditTaskModal`/`SelectField`; `SortField`
   following it is consistency, not a new smell.
3. The duplicated part is ~15 lines of stable, low-churn JSX; the drift-prone part
   (the row) is already extracted into `PickerList`. We de-duplicate what would
   hurt and leave the inert boilerplate inline.

Revisit only if a third picker variant appears (then extract a `usePickerDialog`
open/close hook) — premature today (Ousterhout: don't abstract on a sample of
two divergent cases).

## Actions

- Add `optionLabel` to `PickerList`; use it in `SelectField` and `SortField`;
  remove `SortField`'s `labelFor`.
- Add one `optionLabel` unit test to `PickerList.test.tsx`.
- No change for Finding 2.

## Verification

- `npm run build` — type-checks and bundles.
- `npm test` — all suites pass (existing unchanged + the new `optionLabel` test).
