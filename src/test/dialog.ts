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
