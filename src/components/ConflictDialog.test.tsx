import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ConflictDialog from "./ConflictDialog";
import type { Conflict } from "../api";

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

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
    fireEvent(dialog, new Event("close"));
    expect(onDismiss).toHaveBeenCalled();
  });
});
