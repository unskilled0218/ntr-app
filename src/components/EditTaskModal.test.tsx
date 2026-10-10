import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  it("pre-populates visible fields without exposing contexts", () => {
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
    expect(screen.queryByRole("button", { name: /^context$/i })).toBeNull();
  });

  it("calls onSave with the composed text on submit", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(7, "(A) 2026-06-01 call bank +work @phone due:2026-06-30");
    });
  });

  it("changes visible fields while preserving multiple contexts and creation date", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, contexts: ["phone", "store"], description: `${TASK.description} @store` }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), { target: { value: "call later" } });
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^priority$/i }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "B" }));
    fireEvent.click(screen.getByRole("button", { name: /^project$/i }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "(B) 2026-06-01 call later +home @phone @store due:2026-07-01"));
  });

  it.each(["unchanged", "B", "None"])("keeps completion dates and applies completed priority %s", async (choice) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const completed = { ...TASK, completed: true, priority: null, completion_date: "2026-06-02", description: `${TASK.description} pri:A`, tags: { ...TASK.tags, pri: "A" } };
    render(<EditTaskModal task={completed} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^priority$/i }).textContent).toBe("A");
    if (choice !== "unchanged") {
      fireEvent.click(screen.getByRole("button", { name: /^priority$/i }));
      fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: choice }));
    }
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const priority = choice === "unchanged" ? "A" : choice === "None" ? "" : choice;
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, `x 2026-06-02 2026-06-01 call bank +work @phone due:2026-06-30${priority ? ` pri:${priority}` : ""}`));
  });

  it("shows and preserves saved completed priorities above C", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, completed: true, priority: null, description: `${TASK.description} pri:Z`, tags: { ...TASK.tags, pri: "Z" } }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /^priority$/i }).textContent).toBe("Z");
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "x call bank +work @phone due:2026-06-30 pri:Z"));
  });

  it("uses only the current task's hidden contexts after switching tasks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = { serverLabels: SERVER_LABELS, onSave, onClose: () => {} };
    const { rerender } = render(<EditTaskModal task={TASK} {...props} />);
    rerender(<EditTaskModal task={{ ...TASK, id: 8, contexts: [], description: "plain", projects: [], tags: {} }} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8, "(A) 2026-06-01 plain"));
  });

  it("saves remaining fields on a context-only task without persisting fallback text", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, priority: null, creation_date: null, description: "@phone", projects: [], tags: {} }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "@phone due:2026-07-01"));
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
