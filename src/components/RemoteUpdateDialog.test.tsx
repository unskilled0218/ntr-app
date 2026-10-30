import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RemoteUpdateDialog from "./RemoteUpdateDialog";
import type { Offer } from "../lib/remoteUpdates";

afterEach(cleanup);
const offer: Offer = { resource: "note", snapshot: "changed", identity: "changed" };
it("owns choices and ignores bubbled close events", () => {
  const onUpdate = vi.fn(), onDismiss = vi.fn();
  const { container, rerender } = render(<RemoteUpdateDialog offer={offer} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent(dialog, new Event("close"));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledWith(offer);
  rerender(<RemoteUpdateDialog offer={{ ...offer, resource: "tasks" }} busy={false} error="offline" onUpdate={onUpdate} onDismiss={onDismiss} />);
  expect(screen.getByRole("alert").textContent).toBe("offline");
  fireEvent.click(screen.getByRole("button", { name: "Update" }));
  expect(onUpdate).toHaveBeenCalledTimes(1);
});
it.each(["Escape", "backdrop"])("dismisses %s without invoking Update", (action) => {
  const onUpdate = vi.fn(), onDismiss = vi.fn();
  const { container } = render(<RemoteUpdateDialog offer={offer} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  const dialog = container.querySelector("dialog")!;
  if (action === "Escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
  else fireEvent.click(dialog);
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onUpdate).not.toHaveBeenCalled();
});
