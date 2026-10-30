import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import EditTaskModal from "./EditTaskModal";
import { useState } from "react";
import { cancelDialog, clickWithRemovedTargetLabelActivation, deferDialogCloseEvents, observeProjectHandoffs } from "../test/dialog";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 11, 12));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("EditTaskModal", () => {
  it.each(["(A) call", "(A)"])("rejects submitted %s but retains hidden legacy data and form state", (value) => {
    const onSave = vi.fn();
    render(<EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("reserved for legacy data");
    expect(input.value).toBe(value);
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-06-30");
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("work");
    expect(onSave).not.toHaveBeenCalled();
  });

  it.each([undefined, "(A) 2026-06-02 wrong", "x (A) 2026-06-01 wrong", "(A)broken"])("fails visibly for unsafe raw %s", (raw) => {
    const onSave = vi.fn();
    render(<EditTaskModal task={{ ...TASK, raw: raw as string }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("Cannot safely edit");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("pre-populates visible fields without exposing contexts", () => {
    render(
      <EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={vi.fn()} onClose={() => {}} />,
    );

    const desc = screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement;
    expect(desc.value).toBe("call bank");

    const due = screen.getByLabelText(/due date/i) as HTMLInputElement;
    expect(due.value).toBe("2026-06-30");

    // The picker triggers show the pre-populated selection as their label.
    expect(screen.queryByRole("button", { name: /^priority$/i })).toBeNull();
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
      expect(onSave).toHaveBeenCalledWith(7, "(A) 2026-06-01 call bank +work @phone due:2026-06-30 updated:2026-10-11");
    });
  });

  it("changes visible fields while preserving multiple contexts and creation date", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, contexts: ["phone", "store"], description: `${TASK.description} @store`, raw: `${TASK.raw} @store` }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), { target: { value: "call later" } });
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^project$/i }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "home" }));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "(A) 2026-06-01 call later +home @phone @store due:2026-07-01 updated:2026-10-11"));
  });

  it.each(["pri:A", "pri:B pri:A", ""])("keeps completion dates and submits ordinary text %s", async (text) => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const completed = { ...TASK, completed: true, completion_date: "2026-06-02", description: `${TASK.description} pri:A`, raw: `x (A) 2026-06-02 2026-06-01 ${TASK.description} pri:A`, tags: { ...TASK.tags, pri: "A" } };
    render(<EditTaskModal task={completed} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("call bank pri:A");
    fireEvent.change(screen.getByRole("textbox", { name: /description/i }), { target: { value: `call bank${text ? ` ${text}` : ""}` } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, `x (A) 2026-06-02 2026-06-01 call bank${text ? ` ${text}` : ""} +work @phone due:2026-06-30 updated:2026-10-11`));
  });

  it("shows and preserves ordinary pri:Z text without dates", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, completed: true, creation_date: null, description: `${TASK.description} pri:Z`, raw: `x ${TASK.description} pri:Z`, tags: { ...TASK.tags, pri: "Z" } }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /^priority$/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "x call bank pri:Z +work @phone due:2026-06-30 updated:2026-10-11"));
  });

  it("uses only the current task's hidden contexts after switching tasks", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const props = { serverLabels: SERVER_LABELS, onSave, onClose: () => {} };
    const { rerender } = render(<EditTaskModal task={TASK} {...props} />);
    rerender(<EditTaskModal task={{ ...TASK, id: 8, contexts: [], description: "plain", raw: "(A) 2026-06-01 plain", projects: [], tags: {} }} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(8, "(A) 2026-06-01 plain updated:2026-10-11"));
  });

  it("saves remaining fields on a context-only task without persisting fallback text", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<EditTaskModal task={{ ...TASK, creation_date: null, description: "@phone", raw: "@phone", projects: [], tags: {} }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => {}} />);
    expect((screen.getByRole("textbox", { name: /description/i }) as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText(/due date/i), { target: { value: "2026-07-01" } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(7, "@phone due:2026-07-01 updated:2026-10-11"));
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

  it("stamps Save and retry days without mutating original metadata on failure", async () => {
    const original = { ...TASK, tags: { ...TASK.tags, updated: "2026-10-09", custom: "old" } };
    const snapshot = structuredClone(original);
    const onSave = vi.fn().mockRejectedValueOnce(new Error("disk full")).mockResolvedValueOnce(undefined);
    render(<EditTaskModal task={original} serverLabels={SERVER_LABELS} onSave={onSave} onClose={vi.fn()} />);
    expect(onSave).not.toHaveBeenCalled();
    vi.setSystemTime(new Date(2026, 9, 12, 12));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("disk full"));
    expect(onSave.mock.calls[0][1]).toContain("2026-06-01 call bank");
    expect(onSave.mock.calls[0][1]).toContain("custom:old updated:2026-10-12");
    expect(original).toEqual(snapshot);
    expect((document.getElementById("edit-task-modal") as HTMLDialogElement).open).toBe(true);
    vi.setSystemTime(new Date(2026, 9, 13, 12));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
    expect(onSave.mock.calls[1][1]).toContain("updated:2026-10-13");
    expect(onSave.mock.calls[1][1]).not.toContain("updated:2026-10-09");
    expect(original).toEqual(snapshot);
  });

  it("catches inconsistent completed dates before save instead of losing creation", async () => {
    const original = { ...TASK, completed: true };
    const onSave = vi.fn();
    render(<EditTaskModal task={original} serverLabels={SERVER_LABELS} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("without a completion date"));
    expect(onSave).not.toHaveBeenCalled();
    expect(original.creation_date).toBe("2026-06-01");
  });

  it("does not submit an updated-only description", () => {
    const onSave = vi.fn();
    render(<EditTaskModal task={{ ...TASK, contexts: [], description: "plain", projects: [], tags: {} }} serverLabels={SERVER_LABELS} onSave={onSave} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), { target: { value: "updated:2026-10-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe("EditTaskModal nested dismissal", () => {
  it.each(["Project", "New label"])("retains edits after cancelling %s", (field) => {
    const onClose = vi.fn();
    const onSave = vi.fn();
    function Owner() {
      const [task, setTask] = useState<typeof TASK | null>(TASK);
      return <EditTaskModal task={task} serverLabels={SERVER_LABELS} onSave={onSave} onClose={() => { onClose(); setTask(null); }} />;
    }
    render(<Owner />);
    const input = screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "unfinished edit" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    let child = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
    if (field === "New label") {
      fireEvent.click(within(child).getByRole("button", { name: /\+ add project/i }));
      child = document.getElementById("label-modal") as HTMLDialogElement;
      expect(child.open).toBe(true);
    }
    expect(cancelDialog(child).defaultPrevented).toBe(false);
    expect(child.open).toBe(false);
    const parent = document.getElementById("edit-task-modal") as HTMLDialogElement;
    expect(parent.open).toBe(true);
    expect(input.value).toBe("unfinished edit");
    expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-12-01");
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("work");
    expect(onClose).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(within(parent).getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(parent.open).toBe(false);
  });

  it.each(["Cancel", "backdrop"])("closes a nested label through %s without closing Edit task", (method) => {
    const onClose = vi.fn();
    render(<EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={vi.fn()} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: /\+ add project/i }));
    const label = document.getElementById("label-modal") as HTMLDialogElement;
    if (method === "backdrop") fireEvent.click(label);
    else fireEvent.click(within(label).getByRole("button", { name: "Cancel" }));
    expect(label.open).toBe(false);
    expect((document.getElementById("edit-task-modal") as HTMLDialogElement).open).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(document.querySelector("dialog.select-modal[open]")).not.toBeNull();
  });

  it("preserves Edit task through Cancel and project replacement under modeled label activation", () => {
    const deferred = deferDialogCloseEvents();
    const handoffs = observeProjectHandoffs();
    const onSave = vi.fn();
    const onClose = vi.fn();
    try {
      render(<EditTaskModal task={TASK} serverLabels={SERVER_LABELS} onSave={onSave} onClose={onClose} />);
      const description = screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement;
      fireEvent.change(description, { target: { value: "unfinished edit" } });
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
      const parent = document.getElementById("edit-task-modal") as HTMLDialogElement;
      for (const field of ["Project"]) {
        for (let cycle = 0; cycle < 2; cycle++) {
          fireEvent.click(screen.getByRole("button", { name: field }));
          const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
          clickWithRemovedTargetLabelActivation(within(picker).getByRole("button", { name: "Cancel" }));
          deferred.flush();
          expect(picker.open).toBe(false);
          expect(parent.open).toBe(true);
        }
      }
      for (const action of ["Cancel", "Add"]) {
        fireEvent.click(screen.getByRole("button", { name: "Project" }));
        const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
        clickWithRemovedTargetLabelActivation(within(picker).getByRole("button", { name: /\+ add project/i }));
        const label = document.getElementById("label-modal") as HTMLDialogElement;
        expect(picker.open).toBe(false);
        expect(label.open).toBe(true);
        deferred.flush();
        expect(label.open).toBe(true);
        const input = within(label).getByRole("textbox", { name: "New label name" });
        expect(document.activeElement).toBe(input);
        fireEvent.change(input, { target: { value: "garden" } });
        fireEvent.click(within(label).getByRole("button", { name: action }));
        deferred.flush();
        expect(label.open).toBe(false);
        expect(parent.open).toBe(true);
        expect(screen.getByRole("button", { name: "Project" }).textContent).toBe(action === "Cancel" ? "work" : "garden");
      }
      expect(handoffs.pickerClosedAtOpen).toEqual([true, true]);
      expect(description.value).toBe("unfinished edit");
      expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-12-01");
      expect(screen.queryByRole("button", { name: "Priority" })).toBeNull();
      expect(onSave).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Project" }));
      expect(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "garden" })).toBeTruthy();
    } finally {
      handoffs.restore();
      deferred.restore();
    }
  });
});
