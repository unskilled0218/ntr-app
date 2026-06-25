import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RemoveLabelDialog from "./RemoveLabelDialog";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("RemoveLabelDialog", () => {
  it("does not open when target is null", () => {
    render(<RemoveLabelDialog target={null} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const dialog = document.getElementById("remove-label-dialog") as HTMLDialogElement;
    expect(dialog?.open).toBeFalsy();
  });

  it("opens and names the token when given a target", () => {
    render(
      <RemoveLabelDialog target={{ kind: "project", name: "work" }} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    const dialog = document.getElementById("remove-label-dialog") as HTMLDialogElement;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("+work");
  });

  it("calls onConfirm when Remove is clicked", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveLabelDialog target={{ kind: "context", name: "store" }} onConfirm={onConfirm} onCancel={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^remove$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("calls onCancel when Cancel is clicked", () => {
    const onCancel = vi.fn();
    render(
      <RemoveLabelDialog target={{ kind: "project", name: "work" }} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  // Backdrop dismissal (useBackdropClose, default path): the click runs dialog.close(), whose
  // native close event fires onCancel — the same non-destructive dismiss as Escape/Cancel.
  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    render(
      <RemoveLabelDialog target={{ kind: "project", name: "work" }} onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    const dialog = document.getElementById("remove-label-dialog") as HTMLDialogElement;
    fireEvent.click(dialog); // e.target === dialog -> a backdrop click
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
