// The server/local conflict dialog: two side-by-side version previews and a
// use-server / use-local choice, shown when the local file diverges from the
// server on reconcile. Native <dialog> gives the focus trap, backdrop, and
// Escape handling; dismiss (Escape / backdrop) is intentionally non-destructive
// — it writes nothing, leaving both copies as-is so the user is asked again next
// reconcile rather than silently losing the losing side. Reuses the
// .note-conflict-* styling so no new CSS is needed.

import { useEffect, useRef } from "react";
import type { Conflict, ConflictChoice } from "../api";

interface Props {
  conflict: Conflict | null; // null = closed
  onChoose(choice: ConflictChoice): void;
  onDismiss(): void; // fired by the native close event (Escape / backdrop) = leave both as-is
}

export default function ConflictDialog({ conflict, onChoose, onDismiss }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const open = conflict !== null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const label = conflict?.resource === "tasks" ? "Tasks" : "Note";

  return (
    <dialog id="conflict-dialog" ref={dialogRef} aria-labelledby="conflict-title" onClose={onDismiss}>
      <h2 id="conflict-title">{label} differ from the server</h2>
      <p className="note-conflict-msg">
        Your local {label.toLowerCase()} and the server's copy have diverged. Choose which version to keep.
      </p>
      <div className="note-conflict-versions">
        <section>
          <h3>On this device</h3>
          <pre id="conflict-local" className="note-conflict-text">
            {conflict?.local}
          </pre>
        </section>
        <section>
          <h3>On the server</h3>
          <pre id="conflict-server" className="note-conflict-text">
            {conflict?.server}
          </pre>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" id="conflict-server-btn" onClick={() => onChoose("server")}>
          Use server
        </button>
        <button type="button" id="conflict-local-btn" className="primary" onClick={() => onChoose("local")}>
          Use local
        </button>
      </div>
    </dialog>
  );
}
