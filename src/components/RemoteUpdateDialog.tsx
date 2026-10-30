import { useEffect, useRef } from "react";
import type { Offer } from "../lib/remoteUpdates";
import { dialogWasDismissed, ownDialogEvent } from "./dialogEvents";
import { useBackdropClose } from "./useBackdropClose";
import RemoteDiffPreview from "./RemoteDiffPreview";

interface Props {
  offer: Offer | null;
  busy: boolean;
  error: string;
  onUpdate: (offer: Offer) => void;
  onDismiss: (offer: Offer) => void;
}
export default function RemoteUpdateDialog({ offer, busy, error, onUpdate, onDismiss }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const handled = useRef<Offer | null>(null);
  useEffect(() => {
    handled.current = null;
    if (offer && !ref.current!.open) ref.current!.showModal();
    else if (!offer && ref.current!.open) ref.current!.close();
  }, [offer]);
  useBackdropClose(ref, () => finish(false));
  function finish(update: boolean) {
    if (!offer || busy || handled.current === offer) return;
    if (!update) handled.current = offer;
    if (update) onUpdate(offer); else onDismiss(offer);
  }
  return <dialog ref={ref} id="remote-update" className="action-modal remote-modal" aria-labelledby="remote-update-title" onCancel={(event) => {
    if (!ownDialogEvent(event)) return;
    event.preventDefault();
    finish(false);
  }} onClose={(event) => {
    if (dialogWasDismissed(event)) finish(false);
  }}>
    <h2 id="remote-update-title" className="select-modal-title">{offer?.resource === "tasks" ? "Tasks" : "Note"} changed elsewhere. Update now?</h2>
    <p>Nothing changes until you approve. Unsaved edits remain protected.</p>
    {offer && <RemoteDiffPreview offer={offer} />}
    {error && <p className="modal-error" role="alert">{error}</p>}
    <div className="modal-actions">
      <button type="button" disabled={busy} onClick={() => finish(false)}>Not now</button>
      <button type="button" className="primary" disabled={busy} onClick={() => finish(true)}>{busy ? "Checking…" : "Update"}</button>
    </div>
  </dialog>;
}
