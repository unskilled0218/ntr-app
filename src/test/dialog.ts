import { act, fireEvent } from "@testing-library/react";
import { vi } from "vitest";

// jsdom has no native cancel default action. Match request-close without bubbling.
export function cancelDialog(dialog: HTMLDialogElement) {
  const event = new Event("cancel", { cancelable: true });
  act(() => {
    if (dialog.dispatchEvent(event)) dialog.close();
  });
  return event;
}

// Model label default activation after discrete React updates remove the clicked control.
// jsdom batches the click and does not reproduce this browser timing on its own. This is
// a controlled hypothesis test, not evidence of actual device label activation/hit testing.
export function clickWithRemovedTargetLabelActivation(control: HTMLElement) {
  const label = control.closest("label");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  fireEvent(control, event);
  if (label && !event.defaultPrevented && !label.contains(control)) fireEvent.click(label);
}

// Observe native visibility at the replacement's opening boundary, not just after effects settle.
export function observeProjectHandoffs() {
  const pickerClosedAtOpen: boolean[] = [];
  const showModal = HTMLDialogElement.prototype.showModal;
  const show = vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) {
    if (this.id === "label-modal") {
      pickerClosedAtOpen.push([...document.querySelectorAll<HTMLDialogElement>("dialog.select-modal")].every((picker) => !picker.open));
    }
    showModal.call(this);
  });
  return { pickerClosedAtOpen, restore: () => show.mockRestore() };
}

// Control the browser's queued close-event delivery independently of native visibility.
export function deferDialogCloseEvents() {
  const pending: HTMLDialogElement[] = [];
  const close = vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    pending.push(this);
  });
  return {
    flush() {
      act(() => {
        for (const dialog of pending.splice(0)) fireEvent(dialog, new Event("close"));
      });
    },
    restore() {
      pending.length = 0;
      close.mockRestore();
    },
  };
}
