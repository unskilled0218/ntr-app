// Confirmation for removing a project/context from every task that carries it. Removal is
// destructive and spans many task lines, so it is gated behind a confirm step. Native <dialog>
// gives the focus trap, backdrop, and Escape handling; dismiss (Escape / backdrop / Cancel) is
// non-destructive — it changes nothing. Mirrors ConflictDialog's open-driven-by-a-nullable-prop
// pattern and reuses the .modal-actions / .primary styling, so no new dialog idiom or CSS.

import { useEffect, useRef } from "react";
import { KINDS, type Kind } from "../config";

interface Props {
  target: { kind: Kind; name: string } | null; // null = closed
  onConfirm(): void;
  onCancel(): void; // Cancel button and the native close event (Escape / backdrop)
}

export default function RemoveLabelDialog({ target, onConfirm, onCancel }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = target !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const singular = target ? KINDS[target.kind].singular : "label";
  const token = target ? KINDS[target.kind].prefix + target.name : "";

  return (
    <dialog id="remove-label-dialog" ref={dialogRef} aria-label="Remove label" onClose={onCancel}>
      <h2>Remove {singular}?</h2>
      <p className="note-conflict-msg">
        Remove <strong>{token}</strong> from every task that uses it. This rewrites those tasks and
        cannot be undone.
      </p>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={onConfirm}>
          Remove
        </button>
      </div>
    </dialog>
  );
}
