import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import EditTaskModal from "./EditTaskModal";

vi.mock("../api", () => ({
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const SERVER_LABELS = { project: ["work", "home"], context: ["phone", "store"] };

const TASK = {
  id: 7,
  completed: false,
  priority: "A",
  completion_date: null,
  creation_date: "2026-06-01",
  description: "call bank +work @phone due:2026-06-30",
  projects: ["work"],
  contexts: ["phone"],
  tags: { due: "2026-06-30" },
  raw: "(A) 2026-06-01 call bank +work @phone due:2026-06-30",
};

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("EditTaskModal", () => {
  it("pre-populates description, priority, due, project, context from the task", () => {
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={vi.fn()} onClose={() => {}} />,
    );

    const desc = screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement;
    expect(desc.value).toBe("call bank");

    const due = screen.getByLabelText(/due date/i) as HTMLInputElement;
    expect(due.value).toBe("2026-06-30");

    // The picker triggers show the pre-populated selection as their label.
    expect(screen.getByRole("button", { name: /^priority$/i }).textContent).toBe("A");
    expect(screen.getByRole("button", { name: /^project$/i }).textContent).toBe("work");
    expect(screen.getByRole("button", { name: /^context$/i }).textContent).toBe("phone");
  });

  it("calls onSave with the composed text on submit", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(7, "(A) call bank +work @phone due:2026-06-30");
    });
  });

  it("shows an error message and stays open when onSave rejects", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("network error"));
    const onClose = vi.fn();
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      const alert = screen.getByRole("alert");
      expect(alert.textContent).toContain("network error");
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={onClose} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not open the dialog when task is null", () => {
    render(
      <EditTaskModal task={null} serverLabels={SERVER_LABELS} onSave={vi.fn()} onClose={() => {}} />,
    );
    const dialog = document.getElementById("edit-task-modal") as HTMLDialogElement;
    expect(dialog?.open).toBeFalsy();
  });
});
