import { useEffect, useRef, useState } from "react";
import { parseLabelInput } from "../labels";
import type { ProjectRename } from "../lib/projectRename";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";
import { useBackdropClose } from "./useBackdropClose";

interface Props {
  source: string | null;
  operation: ProjectRename | null;
  count: number;
  onConfirm(name: string): void;
  onClose(): void;
  onReview(): void;
  onAbandon(): void;
}
export default function RenameProjectDialog({ source, operation, count, onConfirm, onClose, onReview, onAbandon }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const busy = operation?.busy ?? false;
  useEffect(() => {
    if (source !== null) {
      setName(operation?.to ?? source); setError("");
      if (!ref.current!.open) ref.current!.showModal();
      input.current?.focus();
    } else if (ref.current!.open) ref.current!.close();
  }, [source]);
  function close() {
    if (busy) return;
    ref.current?.close();
    onClose();
  }
  useBackdropClose(ref, close);
  function review() {
    if (busy) return;
    ref.current?.close(); // Release native modality before the approval dialog can open.
    onReview();
  }
  return <dialog id="rename-project-dialog" ref={ref} aria-label="Rename project" onCancel={(event) => {
    if (!ownDialogEvent(event)) return;
    event.preventDefault(); close();
  }} onClose={(event) => {
    if (dialogWasDismissed(event) && source !== null && !busy) onClose();
  }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy) return;
      const parsed = parseLabelInput(name);
      if ("error" in parsed) { setError(parsed.error); return; }
      setError(""); onConfirm(parsed.name);
    }}>
      <h2>Rename project</h2>
      <p>Rename +{source} in {count} tasks, remembered projects, and matching project references in local drafts. Other draft text stays unchanged.</p>
      <label>New project name<input ref={input} aria-label="New project name" value={name} disabled={busy || operation?.started} onChange={(event) => setName(event.currentTarget.value)} /></label>
      <p role="status">{busy ? "Working… Please wait; issued writes cannot be canceled." : operation?.phase === "completed" ? "Rename completed." : operation?.done.size ? `${operation.done.size} tasks renamed. Completed writes are not rolled back.` : ""}</p>
      {(error || operation?.error) && <p role="alert">{error || operation?.error}</p>}
      {operation?.started && !busy && operation.phase !== "completed" && <p>Stopping retry keeps all completed changes and releases draft restrictions. It does not merge projects or undo the partial rename.</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={close}>{operation?.started ? "Close" : "Cancel"}</button>
        {operation?.phase === "paused-for-review" && <button type="button" onClick={review}>Review update</button>}
        {operation?.started && !busy && operation.phase !== "completed" && <button type="button" onClick={() => {
          ref.current?.close(); onAbandon();
        }}>Stop retry; keep partial changes</button>}
        {operation?.phase !== "completed" && <button type="submit" className="primary" disabled={busy}>{busy ? "Working…" : operation?.phase === "labels-pending" ? "Finish labels" : operation?.started ? "Retry rename" : "Rename"}</button>}
      </div>
    </form>
  </dialog>;
}
