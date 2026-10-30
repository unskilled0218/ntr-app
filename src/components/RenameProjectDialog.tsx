import { useLayoutEffect, useRef, useState } from "react";
import { parseLabelInput } from "../labels";
import type { ProjectRename } from "../lib/projectRename";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";
import { useBackdropClose } from "./useBackdropClose";

interface Props {
  source: string | null;
  operation: ProjectRename | null;
  onConfirm(name: string): void;
  onClose(): void;
  onReview(): void;
  onAbandon(): void;
  id?: string;
  scope?: "draft";
  readOnly?: boolean;
  error?: string;
}
export default function RenameProjectDialog({ source, operation, onConfirm, onClose, onReview, onAbandon, id = "rename-project-dialog", scope, readOnly, error: externalError }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const busy = operation?.busy ?? false;
  const handled = useRef(false);
  useLayoutEffect(() => {
    if (source !== null) {
      handled.current = false;
      setName(operation?.to ?? source); setError("");
      if (!ref.current!.open) ref.current!.showModal();
      input.current?.focus();
    } else if (ref.current!.open) { handled.current = true; ref.current!.close(); }
  }, [source]);
  function finish(action: () => void) {
    if (busy || handled.current) return;
    handled.current = true; ref.current?.close(); action();
  }
  function close() {
    finish(onClose);
  }
  useBackdropClose(ref, close);
  function review() {
    finish(onReview);
  }
  return <dialog id={id} className="action-modal rename-modal" ref={ref} aria-labelledby={`${id}-title`} onCancel={(event) => {
    if (!ownDialogEvent(event)) return;
    event.preventDefault(); close();
  }} onClose={(event) => {
    if (dialogWasDismissed(event) && source !== null && !busy && !handled.current) { handled.current = true; onClose(); }
  }}>
    <form onSubmit={(event) => {
      event.preventDefault();
      if (busy || readOnly) return;
      const parsed = parseLabelInput(name);
      if ("error" in parsed) { setError(parsed.error); return; }
      setError(""); onConfirm(parsed.name);
    }}>
      <h2 id={`${id}-title`} className="select-modal-title">Rename project</h2>
      <div className="original-project" role="group" aria-label="Original"><span>Original</span><strong>{source}</strong></div>
      {scope === "draft" && <p>Changes this draft only.</p>}
      {readOnly && <p role="status">This result belongs to {operation?.targetDestination}. Return to that destination to retry, or explicitly stop retry without rolling back changes.</p>}
      <label>New project name<input ref={input} aria-label="New project name" value={name} disabled={busy || operation?.started} onChange={(event) => setName(event.currentTarget.value)} /></label>
      {(busy || !!operation?.done.size) && <p role="status">{busy ? "Working… Please wait; issued writes cannot be canceled." : `${operation?.done.size} tasks renamed. Completed writes are not rolled back.`}</p>}
      {(error || externalError || operation?.error) && <p className="modal-error" role="alert">{error || externalError || operation?.error}</p>}
      {operation?.started && !busy && operation.phase !== "completed" && <p>Stopping retry keeps all completed changes and releases draft restrictions. It does not merge projects or undo the partial rename.</p>}
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={close}>{operation?.started ? "Close" : "Cancel"}</button>
        {operation?.phase === "paused-for-review" && !readOnly && <button type="button" onClick={review}>Review update</button>}
        {operation?.started && !busy && operation.phase !== "completed" && <button type="button" onClick={() => finish(onAbandon)}>Stop retry; keep partial changes</button>}
        {operation?.phase !== "completed" && <button type="submit" className="primary" disabled={busy || readOnly}>{busy ? "Working…" : operation?.phase === "labels-pending" ? "Finish labels" : operation?.started ? "Retry rename" : "Rename"}</button>}
      </div>
    </form>
  </dialog>;
}
