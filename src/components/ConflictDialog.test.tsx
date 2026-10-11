import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import ConflictDialog from "./ConflictDialog";
import type { Conflict } from "../api";
import { cancelDialog, deferDialogCloseEvents } from "../test/dialog";

afterEach(cleanup);

const NOTE_CONFLICT: Conflict = { resource: "note", local: "my local note", server: "the server note" };

describe("ConflictDialog", () => {
  it("shows the resource title and both versions", () => {
    render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Note out of sync with the server")).toBeTruthy();
    expect(screen.getByText("my local note")).toBeTruthy();
    expect(screen.getByText("the server note")).toBeTruthy();
  });

  it("labels a tasks conflict as Tasks", () => {
    render(<ConflictDialog conflict={{ resource: "tasks", local: "a", server: "b" }} onChoose={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText("Tasks out of sync with the server")).toBeTruthy();
  });

  it("calls onChoose('server') when Use server is clicked", () => {
    const onChoose = vi.fn();
    render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={onChoose} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText("Use server"));
    expect(onChoose).toHaveBeenCalledWith("server");
  });

  it("calls onChoose('local') when Use local is clicked", () => {
    const onChoose = vi.fn();
    render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={onChoose} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByText("Use local"));
    expect(onChoose).toHaveBeenCalledWith("local");
  });

  it("calls onDismiss on the native close event (Escape / backdrop)", () => {
    const onDismiss = vi.fn();
    const { container } = render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={vi.fn()} onDismiss={onDismiss} />);
    const dialog = container.querySelector("dialog") as HTMLDialogElement;
    fireEvent.click(dialog);
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe("ConflictDialog presentations", () => {
  const TASK_CONFLICT: Conflict = { resource: "tasks", local: "second local", server: "second server" };

  it.each(["backdrop", "native cancel", "Use server"])("advances only one queued conflict through %s", (method) => {
    const onChoose = vi.fn();
    const onDismiss = vi.fn();
    function Queue() {
      const [queue, setQueue] = useState([NOTE_CONFLICT, TASK_CONFLICT]);
      return <ConflictDialog conflict={queue[0] ?? null}
        onChoose={(choice) => { onChoose(choice); setQueue((q) => q.slice(1)); }}
        onDismiss={() => { onDismiss(); setQueue((q) => q.slice(1)); }} />;
    }
    render(<Queue />);
    const dialog = document.getElementById("conflict-dialog") as HTMLDialogElement;
    if (method === "backdrop") fireEvent.click(dialog);
    else if (method === "native cancel") cancelDialog(dialog);
    else fireEvent.click(screen.getByRole("button", { name: "Use server" }));
    expect(dialog.open).toBe(true);
    expect(screen.getByText("second local")).toBeTruthy();
    expect(onChoose).toHaveBeenCalledTimes(method === "Use server" ? 1 : 0);
    expect(onDismiss).toHaveBeenCalledTimes(method === "Use server" ? 0 : 1);
    cancelDialog(dialog);
    expect(dialog.open).toBe(false);
    expect(onDismiss).toHaveBeenCalledTimes(method === "Use server" ? 1 : 2);
  });

  it("ignores a queued old close after reopening for a replacement", () => {
    const deferred = deferDialogCloseEvents();
    const onDismiss = vi.fn();
    try {
      const { rerender } = render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={vi.fn()} onDismiss={onDismiss} />);
      const dialog = document.getElementById("conflict-dialog") as HTMLDialogElement;
      act(() => dialog.close());
      rerender(<ConflictDialog conflict={TASK_CONFLICT} onChoose={vi.fn()} onDismiss={onDismiss} />);
      expect(dialog.open).toBe(true);
      deferred.flush();
      expect(dialog.open).toBe(true);
      expect(onDismiss).not.toHaveBeenCalled();
      expect(screen.getByText("second local")).toBeTruthy();
    } finally {
      deferred.restore();
    }
  });

  it("does not treat programmatic completion as cancellation", () => {
    const deferred = deferDialogCloseEvents();
    const onDismiss = vi.fn();
    const onChoose = vi.fn();
    try {
      function Owner() {
        const [conflict, setConflict] = useState<Conflict | null>(NOTE_CONFLICT);
        return <ConflictDialog conflict={conflict} onChoose={(choice) => { onChoose(choice); setConflict(null); }} onDismiss={onDismiss} />;
      }
      render(<Owner />);
      fireEvent.click(screen.getByRole("button", { name: "Use local" }));
      deferred.flush();
      expect(onChoose).toHaveBeenCalledOnce();
      expect(onDismiss).not.toHaveBeenCalled();
      expect((document.getElementById("conflict-dialog") as HTMLDialogElement).open).toBe(false);
    } finally {
      deferred.restore();
    }
  });

  it("does not cancel a choice still waiting for its owner", () => {
    const onChoose = vi.fn();
    const onDismiss = vi.fn();
    render(<ConflictDialog conflict={NOTE_CONFLICT} onChoose={onChoose} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Use local" }));
    fireEvent.click(screen.getByRole("button", { name: "Use server" }));
    cancelDialog(document.getElementById("conflict-dialog") as HTMLDialogElement);
    expect(onChoose).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
