// A drop-in replacement for a labelled <select>: a trigger button showing the current selection
// that opens a native <dialog> listing the options as a vertical list of buttons. Choosing a row
// selects it and closes. Used everywhere a dropdown was, so every chooser in the app looks and
// behaves the same (one deep component instead of nine bespoke selects).
//
// For label pickers, an option may be `removable`: when the caller also passes onRemove, that
// row gets a Remove button on its right. The picker stays ignorant of label semantics — the
// "+ Add..." entry is just an option whose value the caller intercepts in onChange.

import PickerList, { optionLabel, type FieldOption } from "./PickerList";
import { usePickerDialog } from "./usePickerDialog";
import { useEffect, useRef, useState } from "react";
import type { ListAction, ListSelectorSession } from "../lib/listActions";

// Re-exported so the many existing `import { FieldOption } from "./SelectField"` callers are
// untouched; the type's home is now PickerList (it describes a picker row).
export type { FieldOption };

interface Props {
  ariaLabel: string; // accessible name for the trigger and the dialog
  value: string;
  options: FieldOption[];
  onChange(value: string): void;
  onRemove?(value: string, session?: ListSelectorSession): void;
  onRename?(value: string, session?: ListSelectorSession): void;
  retainActions?: boolean;
  revision?: number;
  recoveries?: { id: number; label: string; kind: ListAction }[];
  onRecover?(id: number, session?: ListSelectorSession): void;
}

export default function SelectField({ ariaLabel, value, options, onChange, onRemove, onRename, recoveries, onRecover, retainActions, revision = 0 }: Props) {
  const { dialogRef, open, setOpen, closePicker, onClose, onCancel } = usePickerDialog();
  const generation = useRef(0);
  const [focus, setFocus] = useState<{ name: string; revision: number; generation: number } | null>(null);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    if (!focus || !open || focus.generation !== generation.current || revision < focus.revision) return;
    const dialog = dialogRef.current;
    if (!dialog?.open || !dialog.isConnected) return;
    const buttons = [...dialog.querySelectorAll<HTMLButtonElement>("button")];
    const target = buttons.find((button) => button.getAttribute("aria-label") === `Rename ${focus.name}`)
      ?? buttons.find((button) => button.textContent === focus.name)
      ?? buttons.find((button) => button.textContent === "Cancel");
    target?.focus(); setFocus(null);
  }, [focus, open, revision, options]);
  function session(): ListSelectorSession | undefined {
    if (!retainActions) { closePicker(); return; }
    const id = generation.current;
    return {
      close() {
        if (id !== generation.current || !dialogRef.current?.open) return false;
        generation.current++; closePicker(); return true;
      },
      restore(name, mappedRevision = 0) {
        if (id === generation.current && dialogRef.current?.open) setFocus({ name, revision: mappedRevision, generation: id });
      },
    };
  }

  function choose(v: string) {
    closePicker();
    onChange(v);
  }

  function dispatch<T extends string | number>(callback: ((value: T, origin?: ListSelectorSession) => void) | undefined, value: T) {
    // Close first so a confirm dialog the parent opens from onRemove is not stacked under us.
    // Retained sessions instead let the owner choose after resolving any recovery record.
    const origin = session();
    if (origin) callback?.(value, origin); else callback?.(value);
  }

  return (
    <>
      <button
        type="button"
        className="select-field"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        onClick={() => { generation.current++; setOpen(true); }}
      >
        {optionLabel(options, value)}
      </button>
      {/* Render the contents only while open: a closed dialog leaves no stray focusable buttons in
          the DOM (each field would otherwise contribute an always-present "Cancel"). */}
      <dialog className="select-modal" aria-label={ariaLabel} ref={dialogRef} onClose={onClose} onCancel={onCancel}>
        {open && (
          <>
            <h2 className="select-modal-title">{ariaLabel}</h2>
            <PickerList
              options={options}
              value={value}
              onChoose={choose}
              onRemove={onRemove ? (value) => dispatch(onRemove, value) : undefined}
              onRename={onRename ? (value) => dispatch(onRename, value) : undefined}
              recoveries={recoveries}
              onRecover={(id) => dispatch(onRecover, id)}
            />
            <div className="modal-actions">
              <button type="button" onClick={(event) => {
                event.preventDefault();
                closePicker();
              }}>
                Cancel
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
