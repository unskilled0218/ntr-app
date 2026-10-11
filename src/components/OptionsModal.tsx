// A control group collapsed behind one "Options" button: the trigger plus a <dialog> that renders
// whatever field controls it is handed, with a Done button to close. Used by compact mode to fold
// the add-form fields and the filter choosers each behind a single button. Presentation only — the
// controls passed in stay controlled by their owner (AddForm / FilterBar); this just hides them
// behind a modal. Uses its own `options-modal` dialog class so a SelectField opening its own
// `select-modal` inside it never collides with that selector.

import { type ReactNode } from "react";
import { usePickerDialog } from "./usePickerDialog";

interface Props {
  ariaLabel: string; // accessible name for the trigger and dialog (e.g. "Task options")
  children: ReactNode; // the field controls to show inside the modal
}

export default function OptionsModal({ ariaLabel, children }: Props) {
  const { dialogRef, open, setOpen, closePicker, onClose, onCancel } = usePickerDialog();

  return (
    <>
      <button
        type="button"
        className="options-trigger"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        Options
      </button>
      {/* Contents only while open, so a closed dialog leaves no stray focusable triggers in the DOM. */}
      <dialog className="options-modal" aria-label={ariaLabel} ref={dialogRef} onClose={onClose} onCancel={onCancel}>
        {open && (
          <>
            <h2 className="select-modal-title">{ariaLabel}</h2>
            <div className="options-fields">{children}</div>
            <div className="modal-actions">
              <button type="button" onClick={(event) => {
                event.preventDefault();
                closePicker();
              }}>
                Done
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
