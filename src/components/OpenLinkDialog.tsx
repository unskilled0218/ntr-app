// Confirmation for opening a note link in the system browser, raised by a touch long-press (the desktop
// path, Ctrl/Cmd-click, opens directly and never shows this). Opening leaves the app, so on touch — where
// there is no modifier-click — it is gated behind a confirm step. Mirrors RemoveLabelDialog's
// open-driven-by-a-nullable-prop pattern and reuses the .modal-actions / .primary styling, so no new
// dialog idiom or CSS; dismiss (Escape / backdrop / Cancel) opens nothing.

import { useEffect, useRef } from "react";
import { useBackdropClose } from "./useBackdropClose";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";

interface Props {
  url: string | null; // null = closed
  onConfirm(): void;
  onCancel(): void; // Cancel button and the native close event (Escape / backdrop)
}

export default function OpenLinkDialog({ url, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = url !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Click outside the box dismisses it (non-destructive, same as Escape/Cancel) via onCancel below.
  useBackdropClose(dialogRef);

  return (
    <dialog id="open-link-dialog" ref={dialogRef} aria-label="Open link" onCancel={ownDialogEvent} onClose={(event) => {
      if (dialogWasDismissed(event) && open) onCancel();
    }}>
      <h2>Open link?</h2>
      <p className="note-conflict-msg">
        Open <strong>{url}</strong> in your browser.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          Open
        </button>
      </div>
    </dialog>
  );
}
