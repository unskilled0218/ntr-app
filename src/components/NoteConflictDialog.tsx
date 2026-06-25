// The note conflict dialog: two side-by-side version previews and a keep-mine / use-theirs
// choice. Native <dialog> gives the focus trap, backdrop, and Escape handling; the `close` event
// (Escape / dismiss) defaults to keep-mine upstream so an unanswered prompt never throws away the
// user's unsaved work. Ported from #note-conflict + app.js.

import { useEffect, useRef } from "react";
import { useBackdropClose } from "./useBackdropClose";

interface Props {
  open: boolean;
  mine: string;
  theirs: string;
  onKeepMine: () => void;
  onUseTheirs: () => void;
  onClose: () => void; // fired by the native close event (Escape / dismiss) = keep mine
}

export default function NoteConflictDialog({ open, mine, theirs, onKeepMine, onUseTheirs, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  // Click outside the box dismisses it (keep-mine, same as Escape) via the onClose below.
  useBackdropClose(dialogRef);

  return (
    <dialog id="note-conflict" ref={dialogRef} aria-labelledby="note-conflict-title" onClose={onClose}>
      <h2 id="note-conflict-title">Note changed on another device</h2>
      <p className="note-conflict-msg">
        You have unsaved edits and the note was changed elsewhere. Choose which version to keep.
      </p>
      <div className="note-conflict-versions">
        <section>
          <h3>Your unsaved version</h3>
          <pre id="conflict-mine" className="note-conflict-text">
            {mine}
          </pre>
        </section>
        <section>
          <h3>Incoming version</h3>
          <pre id="conflict-theirs" className="note-conflict-text">
            {theirs}
          </pre>
        </section>
      </div>
      <div className="modal-actions">
        <button type="button" id="conflict-theirs-btn" onClick={onUseTheirs}>
          Use theirs
        </button>
        <button type="button" id="conflict-mine-btn" className="primary" onClick={onKeepMine}>
          Keep mine
        </button>
      </div>
    </dialog>
  );
}
