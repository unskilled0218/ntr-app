// Confirmation for removing a list/context from every task that carries it. Removal is
// destructive and spans many task lines, so it is gated behind a confirm step. Native <dialog>
// gives the focus trap, backdrop, and Escape handling; dismiss (Escape / backdrop / Cancel) is
// non-destructive — it changes nothing. Mirrors ConflictDialog's open-driven-by-a-nullable-prop
// pattern and reuses the .modal-actions / .primary styling, so no new dialog idiom or CSS.

import { useEffect, useRef } from "react";
import { KINDS, type Kind } from "../config";
import { useBackdropClose } from "./useBackdropClose";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";
import type { ListRemoval } from "../lib/listRemoval";

interface Props {
  target: { kind: Kind; name: string } | null; // null = closed
  onConfirm(): void;
  onCancel(): void; // Cancel button and the native close event (Escape / backdrop)
  operation?: ListRemoval | null;
  readOnly?: boolean;
  scope?: "draft";
  id?: string;
  error?: string;
  onReview?: () => void;
  onAbandon?: () => void;
}

export default function RemoveLabelDialog({ target, onConfirm, onCancel, operation, readOnly, scope, id = "remove-label-dialog", error, onReview, onAbandon }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const handled = useRef(false);
  const open = target !== null;
  const busy = operation?.busy ?? false;
  function finish(action: () => void) {
    if (busy || handled.current) return;
    handled.current = true;
    dialogRef.current?.close(); action();
  }
  function close() { finish(onCancel); }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) { handled.current = false; dialog.showModal(); }
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Click outside the box dismisses it (non-destructive, same as Escape/Cancel) via onCancel below.
  useBackdropClose(dialogRef, close);

  const singular = target ? KINDS[target.kind].singular : "label";
  const token = target ? KINDS[target.kind].prefix + target.name : "";

  return (
    <dialog id={id} ref={dialogRef} aria-label="Remove label" onCancel={(event) => {
      if (!ownDialogEvent(event)) return;
      event.preventDefault(); close();
    }} onClose={(event) => {
      if (dialogWasDismissed(event) && open && !busy && !handled.current) { handled.current = true; onCancel(); }
    }}>
      <h2>Remove {singular}?</h2>
      <p className="note-conflict-msg">
        {scope === "draft" ? <>Remove staged choice <strong>{token}</strong> and its exact list references from this draft only. Stored tasks are unchanged.</> : <>Remove <strong>{token}</strong> from every task that uses it and remembered choices. Tasks themselves are not deleted. Completed changes cannot be rolled back.</>}
      </p>
      {readOnly && <p>This result belongs to {operation?.targetDestination}. Return there to retry, or explicitly stop retry.</p>}
      {operation && <p role="status">{busy ? "Working… Issued writes cannot be canceled." : operation.phase === "completed" ? "Removal completed." : `${operation.done.size} tasks updated; completed changes remain.`}</p>}
      {(error || operation?.error) && <p role="alert">{error || operation?.error}</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={close}>
          {operation?.started ? "Close" : "Cancel"}
        </button>
        {operation?.phase === "paused-for-review" && !readOnly && <button type="button" onClick={() => finish(() => onReview?.())}>Review update</button>}
        {operation?.started && !busy && operation.phase !== "completed" && onAbandon && <button type="button" onClick={() => finish(onAbandon)}>Stop retry; keep partial changes</button>}
        {operation?.phase !== "completed" && <button type="button" className="primary" disabled={busy || readOnly} onClick={onConfirm}>
          {busy ? "Working…" : operation?.phase === "labels-pending" ? "Finish labels" : operation?.started ? "Retry removal" : "Remove"}
        </button>}
      </div>
    </dialog>
  );
}
