import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RenameProjectDialog from "./RenameProjectDialog";
import { deferDialogCloseEvents } from "../test/dialog";

afterEach(cleanup);
it.each(["Cancel", "Escape", "backdrop"])("owns %s once and does not submit", (method) => {
  const onClose = vi.fn(), onConfirm = vi.fn();
  render(<RenameProjectDialog source="work" operation={null} onClose={onClose} onConfirm={onConfirm} onReview={vi.fn()} onAbandon={vi.fn()} />);
  const dialog = screen.getByRole("dialog", { name: "Rename project" });
  if (method === "Cancel") fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  else if (method === "Escape") fireEvent(dialog, new Event("cancel", { cancelable: true }));
  else fireEvent.click(dialog);
  expect(onClose).toHaveBeenCalledOnce(); expect(onConfirm).not.toHaveBeenCalled();
});
it("does not treat an owner close as dismissal or a delayed close as a new presentation", () => {
  const delayed = deferDialogCloseEvents(), onClose = vi.fn();
  const props = { operation: null, onClose, onConfirm: vi.fn(), onReview: vi.fn(), onAbandon: vi.fn() };
  try {
    const view = render(<RenameProjectDialog {...props} source="work" />);
    view.rerender(<RenameProjectDialog {...props} source={null} />);
    view.rerender(<RenameProjectDialog {...props} source="work" />);
    delayed.flush();
    expect((screen.getByRole("dialog") as HTMLDialogElement).open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  } finally { delayed.restore(); }
});
