// The combined Sort + Direction picker: one trigger button (the filter row's lone "Sort" control)
// that opens one modal holding both the sort keys and the direction (ASC/DESC) as two PickerList
// groups. Unlike SelectField, choosing a row does NOT close the dialog — the whole point is to set
// the sort key AND the direction in one visit; each pick applies live (sort/dir are client-side
// re-renders, the single source of truth lives in the parent) and a single Done button closes.
// Replaces the two adjacent SelectField triggers (Sort + Direction) with one.

import PickerList, { optionLabel, type FieldOption } from "./PickerList";
import { usePickerDialog } from "../lib/usePickerDialog";

interface Props {
  sort: string;
  dir: string;
  sortOptions: FieldOption[];
  dirOptions: FieldOption[];
  onSort(value: string): void;
  onDir(value: string): void;
}

export default function SortField({ sort, dir, sortOptions, dirOptions, onSort, onDir }: Props) {
  const { dialogRef, open, setOpen } = usePickerDialog();

  // Both choices on the trigger, so the merged control still shows everything the two old triggers did.
  const summary = `${optionLabel(sortOptions, sort)} · ${optionLabel(dirOptions, dir)}`;

  return (
    <>
      <button
        type="button"
        className="select-field"
        aria-label="Sort"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {summary}
      </button>
      {/* Contents only while open, so a closed dialog leaves no stray focusable buttons in the DOM. */}
      <dialog className="select-modal" aria-label="Sort" ref={dialogRef} onClose={() => setOpen(false)}>
        {open && (
          <>
            <h2 className="select-modal-title">Sort</h2>
            <h3 className="picker-group-title">Sort</h3>
            <PickerList options={sortOptions} value={sort} onChoose={onSort} />
            <h3 className="picker-group-title">Direction</h3>
            <PickerList options={dirOptions} value={dir} onChoose={onDir} />
            <div className="modal-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Done
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
