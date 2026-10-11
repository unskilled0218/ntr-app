import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import { useBackdropClose } from "./useBackdropClose";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";

// Self-owned open state for a native <dialog> opened as a modal: returns the ref to attach, the
// current `open` flag, and its setter, keeping the element in step with `open` (showModal/close).
// One home for the self-triggering pickers — SelectField, SortField, OptionsModal — each a trigger
// button plus a modal it opens itself. (LabelModal/EditTaskModal/SettingsModal differ: their open
// state arrives as a prop, so they are not callers.)
export function usePickerDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  // Only this dialog's close event updates its state, including native cancellation.
  function onClose(event: SyntheticEvent<HTMLDialogElement>) {
    if (dialogWasDismissed(event)) setOpen(false);
  }

  // Remove native modal state before a caller can open a replacement dialog.
  function closePicker() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    setOpen(false);
  }

  // Click outside the box closes the picker and routes through its owned close handler.
  useBackdropClose(dialogRef, closePicker);

  return { dialogRef, open, setOpen, closePicker, onClose, onCancel: ownDialogEvent };
}
