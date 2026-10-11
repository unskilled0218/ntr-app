import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AddForm from "./AddForm";
import { cancelDialog, deferDialogCloseEvents } from "../test/dialog";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const EMPTY_LABELS = { project: [], context: [] };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// Open the label picker for `kind`, choose its "+ Add..." row to open the label modal, and confirm
// `name` through it. Scoped to #label-modal because the add form has its own "Add" submit button.
function addLabelViaModal(kind: "project", name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^project$/i }));
  const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
  fireEvent.click(picker.getByRole("button", { name: new RegExp(`\\+ add ${kind}`, "i") }));
  const modal = within(document.getElementById("label-modal") as HTMLElement);
  fireEvent.change(modal.getByLabelText(/new label name/i), { target: { value: name } });
  fireEvent.click(modal.getByRole("button", { name: /add/i }));
}

describe("AddForm", () => {
  // The reported bug: with LabelModal nested inside <form id="add-form">, the modal's submit
  // bubbled (through the React tree) into the add form, creating a stray task and clearing the
  // just-picked label. The modal is now a sibling of the form, so neither happens.
  it("adding a project from the modal keeps it selected and does not submit the task", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} />);

    fireEvent.change(screen.getByRole("textbox", { name: /new task/i }), {
      target: { value: "water plants" },
    });
    addLabelViaModal("project", "garden");

    // The picker trigger now shows the staged, selected label.
    expect(screen.getByRole("button", { name: /^project$/i }).textContent).toBe("garden");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("requires a description even after creating a project", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} />);

    addLabelViaModal("project", "errands");
    fireEvent.submit(document.getElementById("add-form")!);

    expect(screen.getByRole("button", { name: /^project$/i }).textContent).toBe("errands");
    expect(screen.queryByRole("button", { name: /^context$/i })).toBeNull();
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("submitting a task calls onAdd with the composed text and resets the form", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} />);

    const input = screen.getByRole("textbox", { name: /new task/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "call bank" } });
    // Both the form and the (always-rendered) label modal have an "Add" button; scope to the form.
    const form = within(document.getElementById("add-form") as HTMLElement);
    fireEvent.click(form.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("call bank"));
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("compact: hides the inline fields behind a Task options modal, keeping the add row", () => {
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={vi.fn()} compact={true} />);

    // The add row keeps the input + Add; the three fields are not inline.
    expect(screen.getByRole("textbox", { name: /new task/i })).toBeTruthy();
    const form = within(document.getElementById("add-form") as HTMLElement);
    expect(form.getByRole("button", { name: /^add$/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^priority$/i })).toBeNull();

    // Opening the Options modal reveals only Priority / Project / Due controls.
    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    const options = within(document.querySelector("dialog.options-modal[open]") as HTMLElement);
    expect(options.getByRole("button", { name: /^priority$/i })).toBeTruthy();
    expect(options.getByRole("button", { name: /^project$/i })).toBeTruthy();
    expect(options.queryByRole("button", { name: /^context$/i })).toBeNull();
    expect(options.getByLabelText(/due date/i)).toBeTruthy();
  });

  it("compact: label handoff and cancellation preserve Options and unfinished task input", () => {
    const deferred = deferDialogCloseEvents();
    const onAdd = vi.fn();
    try {
      render(<AddForm serverLabels={{ project: ["work"], context: [] }} onAdd={onAdd} compact />);
      const input = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "unfinished task" } });
      fireEvent.click(screen.getByRole("button", { name: "Task options" }));
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
      fireEvent.click(screen.getByRole("button", { name: "Project" }));
      const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
      fireEvent.click(within(picker).getByRole("button", { name: "work" }));
      deferred.flush();
      fireEvent.click(screen.getByRole("button", { name: "Project" }));
      fireEvent.click(within(picker).getByRole("button", { name: /\+ add project/i }));
      const label = document.getElementById("label-modal") as HTMLDialogElement;
      expect(label.open).toBe(true);
      deferred.flush();
      expect(label.open).toBe(true);
      expect((document.querySelector("dialog.options-modal") as HTMLDialogElement).open).toBe(true);
      cancelDialog(label);
      deferred.flush();
      expect(label.open).toBe(false);
      expect((document.querySelector("dialog.options-modal") as HTMLDialogElement).open).toBe(true);
      expect(input.value).toBe("unfinished task");
      expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-12-01");
      expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("work");
      expect(onAdd).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Project" }));
      expect(picker.open).toBe(true);
    } finally {
      deferred.restore();
    }
  });
});
