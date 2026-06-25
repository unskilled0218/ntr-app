// The "+ Add project/context..." modal. Native <dialog> gives a focus trap and Escape-to-dismiss,
// plus click-outside-to-dismiss via useBackdropClose; dismissing changes nothing (the add-form
// select was never moved off its prior value). Ported from #label-modal + app.js openLabelModal/
// confirmLabel.

import { useEffect, useRef, useState } from "react";
import { KINDS, type Kind } from "../config";
import { parseLabelInput } from "../labels";
import { useBackdropClose } from "./useBackdropClose";

interface Props {
  kind: Kind | null; // non-null while open; which kind the new label belongs to
  onConfirm: (kind: Kind, name: string) => void;
  onClose: () => void;
}

export default function LabelModal({ kind, onConfirm, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Open/close the native dialog in step with the `kind` prop, resetting the fields on open.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (kind) {
      setValue("");
      setError(null);
      if (!dialog.open) dialog.showModal();
      inputRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [kind]);

  // Click outside the box dismisses it; the default dialog.close() fires the onClose below.
  useBackdropClose(dialogRef);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    const result = parseLabelInput(value);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onConfirm(kind, result.name);
  }

  return (
    <dialog id="label-modal" ref={dialogRef} onClose={onClose}>
      <form id="label-form" autoComplete="off" onSubmit={submit}>
        <h2 id="label-modal-title">{kind ? `Add ${KINDS[kind].singular}` : "Add"}</h2>
        <label>
          Name
          <input
            id="label-input"
            ref={inputRef}
            type="text"
            aria-label="New label name"
            value={value}
            onChange={(e) => setValue(e.currentTarget.value)}
          />
        </label>
        <p id="label-error" className="modal-error" role="alert" hidden={!error}>
          {error}
        </p>
        <div className="modal-actions">
          <button type="button" id="label-cancel" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
          <button type="submit">Add</button>
        </div>
      </form>
    </dialog>
  );
}
