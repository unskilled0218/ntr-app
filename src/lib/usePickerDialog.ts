import { useEffect, useRef, useState } from "react";

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

  return { dialogRef, open, setOpen };
}
