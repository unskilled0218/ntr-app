// A drop-in replacement for a labelled <select>: a trigger button showing the current selection
// that opens a native <dialog> listing the options as a vertical list of buttons. Choosing a row
// selects it and closes. Used everywhere a dropdown was, so every chooser in the app looks and
// behaves the same (one deep component instead of nine bespoke selects).
//
// For label pickers, an option may be `removable`: when the caller also passes onRemove, that
// row gets a Remove button on its right. The picker stays ignorant of label semantics — the
// "+ Add..." entry is just an option whose value the caller intercepts in onChange.

import PickerList, { optionLabel, type FieldOption } from "./PickerList";
import { usePickerDialog } from "./usePickerDialog";

// Re-exported so the many existing `import { FieldOption } from "./SelectField"` callers are
// untouched; the type's home is now PickerList (it describes a picker row).
export type { FieldOption };

interface Props {
  ariaLabel: string; // accessible name for the trigger and the dialog
  value: string;
  options: FieldOption[];
  onChange(value: string): void;
  onRemove?(value: string): void;
}

export default function SelectField({ ariaLabel, value, options, onChange, onRemove }: Props) {
  const { dialogRef, open, setOpen, closePicker, onClose, onCancel } = usePickerDialog();

  function choose(v: string) {
    closePicker();
    onChange(v);
  }

  function remove(v: string) {
    // Close first so a confirm dialog the parent opens from onRemove is not stacked under us.
    closePicker();
    onRemove?.(v);
  }

  return (
    <>
      <button
        type="button"
        className="select-field"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        {optionLabel(options, value)}
      </button>
      {/* Render the contents only while open: a closed dialog leaves no stray focusable buttons in
          the DOM (each field would otherwise contribute an always-present "Cancel"). */}
      <dialog className="select-modal" aria-label={ariaLabel} ref={dialogRef} onClose={onClose} onCancel={onCancel}>
        {open && (
          <>
            <h2 className="select-modal-title">{ariaLabel}</h2>
            <PickerList
              options={options}
              value={value}
              onChoose={choose}
              onRemove={onRemove ? remove : undefined}
            />
            <div className="modal-actions">
              <button type="button" onClick={(event) => {
                event.preventDefault();
                closePicker();
              }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
