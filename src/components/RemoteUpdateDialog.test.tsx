import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import RemoteUpdateDialog from "./RemoteUpdateDialog";
import type { Offer } from "../lib/remoteUpdates";
import type { Task } from "../api";
import { PREVIEW_CHARACTERS, PREVIEW_ROWS } from "../lib/remoteDiff";

afterEach(cleanup);
const offer: Offer = { resource: "note", baseline: "original", snapshot: "changed", identity: "changed" };
it.each(["note", "tasks"] as const)("shows only diff content and controls for %s, without filtering user prose", (resource) => {
  const raw = "Nothing changes until you approve. Unsaved edits remain protected.";
  const task = { id: 1, raw, completed: false, creation_date: null, completion_date: null } as Task;
  const incoming: Offer = resource === "note" ? { resource, baseline: "", snapshot: raw, identity: raw }
    : { resource, baseline: [], snapshot: [task], identity: raw };
  render(<RemoteUpdateDialog offer={incoming} busy={false} error="" onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: resource === "note" ? "Note update" : "Task update" });
  expect(dialog.querySelector("h1,h2,p")).toBeNull();
  expect(dialog.getAttribute("aria-labelledby")).toBeNull();
  expect(screen.getByLabelText("Change details").textContent).toContain(raw);
  expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});
it.each(["note", "tasks"] as const)("uses an accessible empty marker for empty %s inspection", (resource) => {
  const incoming: Offer = resource === "note" ? { ...offer, baseline: "old", snapshot: "" }
    : { resource, baseline: [], snapshot: [], identity: "empty" };
  render(<RemoteUpdateDialog offer={incoming} busy={false} error="" onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Incoming" }));
  expect(screen.getByRole("img", { name: "Empty content" }).textContent).toBe("∅");
  expect(screen.getByRole("button", { name: "Update" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});
it("retains lifecycle-only task evidence and note EOF differences as diff metadata", () => {
  const task = { id: 1, raw: "same", completed: false, creation_date: null, completion_date: null } as Task;
  const props = { busy: false, error: "", onUpdate: vi.fn(), onDismiss: vi.fn() };
  const view = render(<RemoteUpdateDialog {...props} offer={{ resource: "tasks", baseline: [task], snapshot: [{ ...task, completed: true }], identity: "changed" }} />);
  expect(screen.getByLabelText("Change details").textContent).toContain("active");
  expect(screen.getByLabelText("Change details").textContent).toContain("completed");
  view.rerender(<RemoteUpdateDialog {...props} offer={{ ...offer, baseline: "a\n", snapshot: "a" }} />);
  expect(screen.getByRole("note", { name: "Trailing newline: accepted yes; incoming no" }).textContent).toBe("@@ EOF − LF / + none @@\n");
});
it("retries the exact failed offer and clears the retry label when the error clears", () => {
  const onUpdate = vi.fn();
  const props = { offer, busy: false, onUpdate, onDismiss: vi.fn() };
  const view = render(<RemoteUpdateDialog {...props} error="offline" />);
  fireEvent.click(screen.getByRole("button", { name: "Retry update" }));
  expect(onUpdate).toHaveBeenCalledWith(offer);
  expect(screen.getByRole("dialog", { name: "Note update" })).toBeTruthy();
  view.rerender(<RemoteUpdateDialog {...props} error="" />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "Update" }).getAttribute("aria-describedby")).toBeNull();
});
it("renders saved evidence as escaped text, not Markdown or HTML", () => {
  render(<RemoteUpdateDialog offer={{ ...offer, baseline: "<button>old</button>", snapshot: "<script>alert(1)</script>" }} busy={false} error="" onUpdate={vi.fn()} onDismiss={vi.fn()} />);
  const preview = screen.getByLabelText("Change details");
  expect(preview.textContent).toContain("<button>old</button>");
  expect(preview.textContent).toContain("<script>alert(1)</script>");
  expect(preview.querySelector("button,script")).toBeNull();
  expect(screen.queryByRole("heading")).toBeNull();
  expect(screen.getByRole("dialog", { name: "Note update" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});
it.each(["x".repeat(100_000), "a\n".repeat(30_000)])("keeps every inspected page bounded and resets on new evidence", (baseline) => {
  const onUpdate = vi.fn(), onDismiss = vi.fn();
  const incoming: Offer = { ...offer, baseline, snapshot: "incoming" };
  const view = render(<RemoteUpdateDialog offer={incoming} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  for (let index = 0; index < 4; index++) {
    const preview = screen.getByLabelText("Change details");
    expect(preview.textContent!.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + PREVIEW_ROWS * 2);
    expect(preview.children.length).toBeLessThanOrEqual(PREVIEW_ROWS);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(false);
  }
  expect(screen.getByRole("status", { name: "Page 5" }).textContent).toBe("5");
  fireEvent.click(screen.getByRole("button", { name: "Previous" })); expect(screen.getByRole("status", { name: "Page 4" })).toBeTruthy();
  for (const mode of ["Accepted", "Incoming", "Diff"]) {
    fireEvent.click(screen.getByRole("button", { name: mode }));
    if (mode !== "Incoming") expect(screen.getByRole("status", { name: "Page 1" })).toBeTruthy();
    else expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.getByLabelText("Change details").textContent!.length).toBeLessThanOrEqual(PREVIEW_CHARACTERS + PREVIEW_ROWS * 2);
    expect((screen.getByRole("button", { name: "Not now" }) as HTMLButtonElement).disabled).toBe(false);
  }
  view.rerender(<RemoteUpdateDialog offer={offer} busy={false} error="" onUpdate={onUpdate} onDismiss={onDismiss} />);
  expect(screen.queryByRole("status")).toBeNull();
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
  expect(screen.getByRole("alert").classList.contains("sr-only")).toBe(true);
  expect(screen.getByRole("button", { name: "Retry update" }).getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
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
  fireEvent.click(screen.getByRole("button", { name: "Retry update" }));
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
