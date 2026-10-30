import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import RemoteUpdateDialog from "./RemoteUpdateDialog";
import type { Offer } from "../lib/remoteUpdates";
import { PREVIEW_CHARACTERS, PREVIEW_ROWS } from "../lib/remoteDiff";

afterEach(cleanup);
const offer: Offer = { resource: "note", baseline: "original", snapshot: "changed", identity: "changed" };
it("renders saved evidence as escaped text, not Markdown or HTML", () => {
  render(<RemoteUpdateDialog offer={{ ...offer, baseline: "<button>old</button>", snapshot: "<script>alert(1)</script>" }} busy={false} error="" onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  const preview = screen.getByLabelText("Change details");
  expect(preview.textContent).toContain("<button>old</button>");
  expect(preview.textContent).toContain("<script>alert(1)</script>");
  expect(preview.querySelector("button,script")).toBeNull();
  expect(screen.getByText(/Unsaved edits are not compared/)).toBeTruthy();
});
it.each(["x".repeat(100_000), "a\n".repeat(30_000)])("keeps every inspected page bounded and resets on new evidence", (baseline) => {
  const onUpdate = vi.fn(), onDismiss = vi.fn();
  const incoming: Offer = { ...offer, baseline, snapshot: "incoming" };
  const view = render(<RemoteUpdateDialog offer={incoming} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  for (let index = 0; index < 4; index++) {
    const preview = screen.getByLabelText("Change details");
    expect(preview.textContent!.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + PREVIEW_ROWS * 2);
    expect(preview.children.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Next changes" }));
    expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect(screen.getByText(/Page 5;/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Previous changes" })); expect(screen.getByText(/Page 4;/)).toBeTruthy();
  for (const mode of ["Accepted", "Incoming", "Diff"]) {
    fireEvent.click(screen.getByRole("button", { name: mode }));
    expect(screen.getByText(/Page 1;/)).toBeTruthy();
    expect(screen.getByLabelText("Change details").textContent!.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + PREVIEW_ROWS * 2);
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(false);
  }
  view.rerender(<RemoteUpdateDialog offer={offer} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  expect(screen.getByText(/Page 1;/)).toBeTruthy();
  expect(within(screen.getByLabelText("Change details")).getByText(/original/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Update" })); expect(onUpdate).toHaveBeenCalledWith(offer);
  expect(onDismiss).not.toHaveBeenCalled();
});
it("keeps preview available during preparation errors and busy dismissal disabled", () => {
  const onDismiss = vi.fn();
  const view = render(<RemoteUpdateDialog offer={offer} busy error="" onUpdate={vi.fn()} onDismiss={onDismiss} />);
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
  fireEvent.click(screen.getByRole("dialog")); expect(onDismiss).not.toHaveBeenCalled();
  view.rerender(<RemoteUpdateDialog offer={offer} busy={false} error="read failed" onUpdate={vi.fn()} onDismiss={onDismiss} />);
  expect(screen.getByRole("alert").textContent).toBe("read failed");
  expect(screen.getByLabelText("Change details").textContent).toContain("changed");
});
it("owns choices and ignores bubbled close events", () => {
  const onUpdate = vi.fn(), onDismiss = vi.fn();
  const { container, rerender } = render(<RemoteUpdateDialog offer={offer} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  const dialog = container.querySelector("dialog")!;
  expect(dialog.open).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  fireEvent(dialog, new Event("close"));
  expect(onDismiss).toHaveBeenCalledTimes(1);
  expect(onDismiss).toHaveBeenCalledWith(offer);
  rerender(<RemoteUpdateDialog offer={{ resource: "tasks", baseline: [], snapshot: [], identity: "tasks" }} busy={false} error="offline" onUpdate={onUpdate} onDismiss={onDismiss} />);
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
