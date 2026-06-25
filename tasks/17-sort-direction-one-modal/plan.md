# 17 - One Sort modal (Sort key + Direction, single trigger)

## Goal

Collapse the filter row's two adjacent choosers — **Sort** (sort key) and
**Direction** (ASC/DESC) — into a **single trigger button named "Sort"** that
opens **one modal** holding both choices. The user picks a sort key and a
direction in that one modal; both apply to the list. After this change the
filter row reads Status / Project / Context / **Sort** (one control), not
Status / Project / Context / Sort / Direction (two controls).

Nothing about *what* sorting does changes: the sort keys, the direction
semantics, and the client-side `sortTasks(tasks, sort, dir)` pipeline are
untouched. This task is purely the **presentation** of the two existing choosers
as one combined picker.

## Why a new component, not a wider SelectField

Today every chooser is a `SelectField` (`src/components/SelectField.tsx`): one
trigger button + a `<dialog>` listing **one** group of options, where choosing a
row both selects it **and closes** the dialog (`choose()` calls `setOpen(false)`
then `onChange`). That close-on-pick behaviour is correct for a single choice but
is exactly wrong here: the whole point of "one modal" is to set the sort key
**and** the direction in one visit, so the dialog must stay open across the first
pick.

So the combined control needs different dialog behaviour (stay open, apply each
pick live, an explicit Done to close) and a two-group body. That is a genuinely
different component, not a flag on `SelectField`. Adding a "don't close" / "second
group" mode to `SelectField` would fork its one clear behaviour into two and make
the common single-select case carry config it never uses (a shallow,
harder-to-read module). Instead:

- Keep `SelectField` exactly as is — the single-select picker, unchanged.
- Add a dedicated **`SortField`** — the combined Sort + Direction picker.

### One home for "how an option row looks": extract `PickerList`

The one thing `SortField` *should* share with `SelectField` is the appearance and
behaviour of an **option row** (the `<ul class="picker-list">` of
`.picker-choice` buttons, the `aria-current` highlight, the optional Remove
button). Today that markup lives only inside `SelectField`. If `SortField`
copy-pasted it, the look of a picker row would have two homes that could drift.

So extract the option-list markup into a small presentational component
**`PickerList`** and have **both** `SelectField` and `SortField` render through it.
This is the only structural refactor in the task and it removes real duplication
rather than adding indirection: one home for "what a selectable option row is".

What is **not** extracted is the picker *shell* — the trigger `<button
class="select-field">`, the `<dialog class="select-modal">` wrapper, the
open-state `useState` + `useEffect`, and the bottom action button. `SortField`
re-states that scaffold rather than sharing it with `SelectField`, and that is a
deliberate trade, not an oversight:

- The two components' shells **diverge** where it matters: `SelectField` closes on
  every pick and shows one value on its trigger; `SortField` stays open across
  picks, shows a two-part `sort · dir` summary, and ends with **Done** not Cancel.
  A shared shell would have to absorb those differences as flags/branches/children
  — turning one clear component into a shallow, parameterized one (exactly the
  smell to avoid: a module whose interface complexity approaches its body).
- The open/close `useEffect` specifically is *already* duplicated by established
  convention across `LabelModal`, `EditTaskModal`, and `SelectField` (each carries
  the comment "same pattern as LabelModal/EditTaskModal"). `SortField` following
  that same convention is consistency with the codebase, not a new smell.
- The duplicated scaffold is ~15 lines of stable, low-churn JSX (a button and a
  `<dialog>`). The volatile, drift-prone part — what an option *row* looks like —
  is the part extracted into `PickerList`. We de-duplicate the thing that would
  hurt if it diverged and leave the inert boilerplate inline.

So `PickerList` is the right seam (one home for the row), and a shared shell is
deliberately rejected (it would couple two divergent behaviours).

## Where each concern lives (one home per concern)

| Concern | Home | Change |
|---|---|---|
| One selectable option row (markup + `aria-current` + Remove) | **new `PickerList`** (`src/components/PickerList.tsx`) | Add; owns `FieldOption` |
| `FieldOption` type | moves to `PickerList`; `SelectField` re-exports it | So existing `import { FieldOption } from "./SelectField"` keeps working |
| Single-select picker (one group, close-on-pick) | `SelectField` | Render its list via `<PickerList>`; no behaviour change |
| Combined Sort + Direction picker (two groups, stay-open, Done) | **new `SortField`** (`src/components/SortField.tsx`) | Add |
| Which choosers the filter row shows | `FilterBar` (`src/components/FilterBar.tsx`) | Replace the Sort + Direction `<SelectField>`s with one `<SortField>` |
| Sort/direction state + callbacks | `TodoPane` (`src/components/TodoPane.tsx`) | **No change** — still owns `sort`/`dir` and passes the same props to `FilterBar` |
| Sort keys, direction table, `sortTasks` | `src/config.ts` | **No change** |
| Version | package.json, tauri.conf.json, Cargo.toml, Cargo.lock | Bumped 0.5.0 -> 0.6.0 (done) |

No backend (`src-tauri/`) or `api.ts` change.

## `PickerList` (`src/components/PickerList.tsx`) — new

Lift the existing list body out of `SelectField` verbatim (same class names, same
`aria-current`, same Remove rule) into a pure presentational component. It owns
`FieldOption` so the row shape and the row markup live together.

```tsx
// One group of selectable rows inside a picker modal: a vertical <ul> of option buttons with the
// current selection marked (aria-current), plus an optional Remove button per row (label pickers
// only). Shared by SelectField (its one group) and SortField (the Sort and Direction groups) so an
// option row looks and behaves identically everywhere — one home for "what a picker row is".

export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right (needs onRemove)
}

interface Props {
  options: FieldOption[];
  value: string;
  onChoose(value: string): void;
  onRemove?(value: string): void;
}

export default function PickerList({ options, value, onChoose, onRemove }: Props) {
  return (
    <ul className="picker-list">
      {options.map((o) => (
        <li key={o.value} className="picker-option">
          <button
            type="button"
            className="picker-choice"
            aria-current={o.value === value ? "true" : undefined}
            onClick={() => onChoose(o.value)}
          >
            {o.label}
          </button>
          {o.removable && onRemove && (
            <button
              type="button"
              className="picker-remove"
              aria-label={`Remove ${o.label}`}
              onClick={() => onRemove(o.value)}
            >
              Remove
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
```

## `SelectField` (`src/components/SelectField.tsx`) — render through `PickerList`

Behaviour is unchanged (still closes on pick). Only the inline `<ul>` is replaced
by `<PickerList>`, and `FieldOption` now comes from `PickerList`:

- Replace `export interface FieldOption {...}` with a re-export so existing
  importers are untouched: `export type { FieldOption } from "./PickerList";`
  and `import PickerList, { type FieldOption } from "./PickerList";`.
- In the dialog body, swap the hand-written `<ul class="picker-list">…</ul>` for:

  ```tsx
  <PickerList options={options} value={value} onChoose={choose} onRemove={onRemove ? remove : undefined} />
  ```

  `choose`/`remove` already do the close-then-callback dance, so the single-select
  semantics are preserved exactly. `SelectField.test.tsx` (selection closes the
  dialog, Remove appears only with `onRemove`) is the regression guard and must
  stay green with no edits.

## `SortField` (`src/components/SortField.tsx`) — new

One trigger button (the filter row's lone "Sort" control) opening one dialog with
two `PickerList` groups: the sort keys, then the directions.

### Props

```tsx
import { useEffect, useRef, useState } from "react";
import PickerList, { type FieldOption } from "./PickerList";

interface Props {
  sort: string;
  dir: string;
  sortOptions: FieldOption[];
  dirOptions: FieldOption[];
  onSort(value: string): void;
  onDir(value: string): void;
}
```

`FilterBar` already builds `SORT_OPTIONS` and `DIRECTION_OPTIONS` from
`SORTS`/`DIRECTIONS`; they pass straight through as `sortOptions`/`dirOptions`, so
the option tables stay the single source of truth and `SortField` stays ignorant
of the sort domain (it just renders two labelled groups).

### Behaviour — apply live, stay open, Done to close

- Trigger: a `.select-field` button (same look + ▾ as the other choosers),
  `aria-label="Sort"`, showing the current selection as
  `` `${sortLabel} · ${dirLabel}` `` (e.g. "Priority · DESC") — both choices are
  visible at a glance, which is the reason for merging them. `sortLabel`/`dirLabel`
  are looked up from the option arrays with the same first-option fallback
  `SelectField` uses.
- Dialog (`className="select-modal"`, `aria-label="Sort"`, driven by the same
  open/close `useEffect` + `onClose` as `SelectField`): title "Sort", then a
  "Sort" group heading + `<PickerList options={sortOptions} value={sort}
  onChoose={onSort} />`, then a "Direction" group heading + `<PickerList
  options={dirOptions} value={dir} onChoose={onDir} />`, then a single
  `.modal-actions` button **"Done"** that closes.
- Choosing a row calls `onSort`/`onDir` and **does not close** — the dialog stays
  open so the other group can also be set in one visit. This is the deliberate
  difference from `SelectField`.

### Why live-apply and not a draft + Apply

The selections take effect immediately (each pick calls the parent setter) rather
than buffering a draft that an Apply button commits. One reason, no special case:
`sort` and `dir` are already client-only render state — changing them re-renders
the list with no refetch (the existing task-16 design). A draft would introduce a
**second** source of truth for the current sort/direction inside `SortField`,
which then has to be seeded from props, kept in sync, and reset on cancel — more
state and a sync bug surface, for no behavioural gain on a cheap re-render. Live
apply keeps one source of truth (the parent's `sort`/`dir`) and matches how every
other chooser already works (each `onChange` applies straight away). The trigger's
`X · Y` summary and the in-list `aria-current` highlights give the feedback that a
modal backdrop would otherwise hide. The bottom button is therefore "Done"
(dismiss), not "Cancel" (which would falsely imply a revert).

### Subgroup headings + minimal CSS

Each group gets a small heading so the two lists are distinguishable. Reuse the
existing modal title style for the dialog title (`.select-modal-title`) and add
one tiny class for the group headings:

```css
/* Sort modal: a heading above each option group (Sort, Direction). */
.picker-group-title {
  margin: 0.5rem 0 0.35rem;
  font-size: 0.85rem;
  color: var(--muted);
}
```

Headings are rendered as `<h3 className="picker-group-title">Sort</h3>` /
`Direction`, under the dialog's `<h2 className="select-modal-title">Sort</h2>`, so
the heading levels nest correctly.

## `FilterBar` (`src/components/FilterBar.tsx`) — one control instead of two

`Props` are **unchanged** (`sort`, `dir`, `onSort`, `onDir` all stay), so
`TodoPane` needs no edit. Only the rendered JSX changes:

- Import `SortField` (drop the now-unneeded direct `SelectField` import **only if**
  Sort/Direction were its last users — Status/Project/Context still use
  `SelectField`, so the import stays).
- `SORT_OPTIONS` and `DIRECTION_OPTIONS` stay (now passed into `SortField`).
- Replace the two trailing blocks:

  ```tsx
  <label>Sort <SelectField ariaLabel="Sort order" .../></label>
  <label>Direction <SelectField ariaLabel="Sort direction" .../></label>
  ```

  with one:

  ```tsx
  <label>
    Sort
    <SortField
      sort={sort}
      dir={dir}
      sortOptions={SORT_OPTIONS}
      dirOptions={DIRECTION_OPTIONS}
      onSort={onSort}
      onDir={onDir}
    />
  </label>
  ```

The Status / Project / Context blocks are untouched.

## `TodoPane` (`src/components/TodoPane.tsx`) — no change

It still owns `sort`/`dir`, still calls `sortTasks(tasks, sort, dir)`, and still
passes `sort`/`dir`/`onSort`/`onDir` to `FilterBar`. The merge is entirely below
this layer.

## Tests

1. **`src/components/PickerList.test.tsx`** (new, small) — the extracted row
   component in isolation: renders one button per option; marks the row whose
   value equals `value` with `aria-current="true"`; calls `onChoose` with the
   row's value on click; shows a Remove button only on `removable` rows **and**
   only when `onRemove` is passed, calling `onRemove` with the value. This locks
   the row contract both `SelectField` and `SortField` now depend on.

2. **`src/components/SelectField.test.tsx`** (existing) — must stay green with **no
   edits**: it is the proof that routing the list through `PickerList` did not
   change single-select behaviour (pick closes the dialog; Remove gated on
   `onRemove`). If anything here needs changing, the refactor changed behaviour
   and is wrong.

3. **`src/components/SortField.test.tsx`** (new) — the combined picker:
   - The trigger has accessible name "Sort" and shows the current
     `sort · dir` summary (e.g. "File order · ASC").
   - Clicking it opens one dialog containing **both** the sort options
     (File order / Priority / Due date / Created / Projects / Contexts) and the
     direction options (ASC / DESC).
   - Choosing a sort row calls `onSort` with its value **and leaves the dialog
     open** (assert the dialog is still `[open]` and the direction options are
     still present) — the core "one modal, two choices" behaviour.
   - Choosing a direction row calls `onDir` with its value.
   - "Done" closes the dialog.
   - The current `sort`/`dir` rows carry `aria-current="true"`.
   Follow `SelectField.test.tsx`'s dialog-interaction pattern (the jsdom
   `showModal` polyfill in `src/test/setup.ts`).

4. **`src/components/FilterBar.test.tsx`** (existing, **update**) — the row now has
   one "Sort" trigger, not separate "Sort order" / "Sort direction" triggers.
   Rewrite the two sort/direction cases into one: open the "Sort" picker and
   assert it offers Projects/Contexts (and not A-Z) **and** ASC/DESC, that
   choosing Projects calls `onSort("projects")`, and that choosing DESC calls
   `onDir("desc")` without the dialog closing in between. Keep the Status/Project/
   Context cases unchanged. Update the "does not offer Remove on the Status or Sort
   pickers" case to open the picker by its new "Sort" name.

No `config.test.ts` change — sorting logic is untouched.

## Verification

- `npm test` — all suites pass (existing, updated FilterBar, new PickerList +
  SortField).
- `npm run build` (tsc + vite) — type-checks the new components, the `PickerList`
  re-export of `FieldOption`, and the new `SortField` props; bundles.
- Manual, local mode: the filter row shows one **Sort** button (e.g.
  "File order · ASC"); clicking it opens a single modal with a Sort group and a
  Direction group; picking Priority then DESC updates the trigger to
  "Priority · DESC" and reorders the list, all without the modal closing between
  the two picks or refetching from the server; Done closes it; the Status /
  Project / Context choosers are unchanged.

## Out of scope

- **No change to sort behaviour** — keys, direction semantics (`desc` negates the
  comparator), and `sortTasks` are exactly as task 16 left them.
- **No persistence** of sort/direction across launches (unchanged from today).
- **No change to the other choosers** — Status / Project / Context stay as
  `SelectField`s, including the label Remove flow.
- **No backend / `api.ts` / `src-tauri` change** beyond the version bump.
- **No draft/Apply buffering** — selections apply live (rationale above).
