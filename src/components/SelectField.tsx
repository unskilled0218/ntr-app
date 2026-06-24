// A drop-in replacement for a labelled <select>: a trigger button showing the current selection
// that opens a native <dialog> listing the options as a vertical list of buttons. Choosing a row
// selects it and closes. Used everywhere a dropdown was, so every chooser in the app looks and
// behaves the same (one deep component instead of nine bespoke selects).
//
// For label pickers, an option may be `removable`: when the caller also passes onRemove, that
// row gets a Remove button on its right. The picker stays ignorant of label semantics — the
// "+ Add..." entry is just an option whose value the caller intercepts in onChange.

import { useEffect, useRef, useState } from "react";

export interface FieldOption {
  value: string;
  label: string;
  removable?: boolean; // show a Remove button on this row's right (needs onRemove)
}

interface Props {
  ariaLabel: string; // accessible name for the trigger and the dialog
  value: string;
  options: FieldOption[];
  onChange(value: string): void;
  onRemove?(value: string): void;
}

export default function SelectField({ ariaLabel, value, options, onChange, onRemove }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  // Drive the native dialog in step with `open` (same pattern as LabelModal/EditTaskModal).
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The trigger shows the selected option's label, falling back to the first option's.
  const selected = options.find((o) => o.value === value) ?? options[0];

  function choose(v: string) {
    setOpen(false);
    onChange(v);
  }

  function remove(v: string) {
    // Close first so a confirm dialog the parent opens from onRemove is not stacked under us.
    setOpen(false);
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
        {selected?.label ?? ""}
      </button>
      {/* Render the contents only while open: a closed dialog leaves no stray focusable buttons in
          the DOM (each field would otherwise contribute an always-present "Cancel"). */}
      <dialog className="select-modal" aria-label={ariaLabel} ref={dialogRef} onClose={() => setOpen(false)}>
        {open && (
          <>
            <h2 className="select-modal-title">{ariaLabel}</h2>
            <ul className="picker-list">
              {options.map((o) => (
                <li key={o.value} className="picker-option">
                  <button
                    type="button"
                    className="picker-choice"
                    aria-current={o.value === value ? "true" : undefined}
                    onClick={() => choose(o.value)}
                  >
                    {o.label}
                  </button>
                  {o.removable && onRemove && (
                    <button
                      type="button"
                      className="picker-remove"
                      aria-label={`Remove ${o.label}`}
                      onClick={() => remove(o.value)}
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <div className="modal-actions">
              <button type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
