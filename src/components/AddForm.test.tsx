import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AddForm from "./AddForm";
import { cancelDialog, clickWithRemovedTargetLabelActivation, deferDialogCloseEvents, observeListHandoffs } from "../test/dialog";
import { captureTransport, destination } from "../api";
import type { ListManagement } from "../lib/listActions";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const EMPTY_LABELS = { list: [], context: [] };

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// Open the label picker for `kind`, choose its "+ Add..." row to open the label modal, and confirm
// `name` through it. Scoped to #label-modal because the add form has its own "Add" submit button.
function addLabelViaModal(kind: "list", name: string) {
  fireEvent.click(screen.getByRole("button", { name: /^list$/i }));
  const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
  fireEvent.click(picker.getByRole("button", { name: new RegExp(`\\+ add ${kind}`, "i") }));
  const modal = within(document.getElementById("label-modal") as HTMLElement);
  fireEvent.change(modal.getByLabelText(/new label name/i), { target: { value: name } });
  fireEvent.click(modal.getByRole("button", { name: /add/i }));
}

describe("AddForm", () => {
  it("refuses a staged-only confirmation if its source becomes globally known", () => {
    const onAdd = vi.fn(), onAction = vi.fn(() => false);
    const management: ListManagement = { destination: destination(captureTransport()), pending: [], onAction, onRecover: vi.fn() };
    const view = render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} management={management} />);
    addLabelViaModal("list", "draftOnly");
    fireEvent.click(screen.getByRole("button", { name: "List" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: "Remove draftOnly" }));
    view.rerender(<AddForm serverLabels={{ list: ["draftOnly"], context: [] }} onAdd={onAdd} compact={false} management={management} />);
    const prompt = within(document.querySelector("#draft-remove-list-dialog") as HTMLElement);
    fireEvent.click(prompt.getByRole("button", { name: "Remove" }));
    expect(prompt.getByRole("alert").textContent).toContain("scope or draft changed");
    expect(onAdd).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "List" }).textContent).toBe("draftOnly");
  });
  it.each([false, true])("accepts ordinary text and repeated pri: tokens (compact=%s)", async (compact) => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={compact} />);
    for (const description of ["(A)call", "(a) call", "call (A)", "call pri:A pri:B pri:A"]) {
      fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: description } });
      fireEvent.submit(document.getElementById("add-form")!);
      await waitFor(() => expect(onAdd).toHaveBeenLastCalledWith(description));
      await waitFor(() => expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe(""));
    }
    expect(screen.queryByRole("button", { name: "Priority" })).toBeNull();
  });

  it.each([false, true])("rejects ambiguous input without losing fields (compact=%s)", (compact) => {
    const onAdd = vi.fn();
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={compact} />);
    if (compact) fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
    if (compact) fireEvent.click(screen.getByRole("button", { name: "Done" }));
    const input = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
    for (const value of ["(A) call", "(A)"]) {
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(document.getElementById("add-form")!);
      expect(screen.getByRole("alert").textContent).toContain("reserved for legacy data");
      expect(input.value).toBe(value);
      if (compact) fireEvent.click(screen.getByRole("button", { name: "Task options" }));
      expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-12-01");
      if (compact) fireEvent.click(screen.getByRole("button", { name: "Done" }));
      expect(onAdd).not.toHaveBeenCalled();
    }
  });

  // The reported bug: with LabelModal nested inside <form id="add-form">, the modal's submit
  // bubbled (through the React tree) into the add form, creating a stray task and clearing the
  // just-picked label. The modal is now a sibling of the form, so neither happens.
  it("adding a list from the modal keeps it selected and does not submit the task", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} />);

    fireEvent.change(screen.getByRole("textbox", { name: /new task/i }), {
      target: { value: "water plants" },
    });
    addLabelViaModal("list", "garden");

    // The picker trigger now shows the staged, selected label.
    expect(screen.getByRole("button", { name: /^list$/i }).textContent).toBe("garden");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("requires a description even after creating a list", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} compact={false} />);

    addLabelViaModal("list", "errands");
    fireEvent.submit(document.getElementById("add-form")!);

    expect(screen.getByRole("button", { name: /^list$/i }).textContent).toBe("errands");
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

    // Opening the Options modal reveals only List / Due controls.
    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    const options = within(document.querySelector("dialog.options-modal[open]") as HTMLElement);
    expect(options.queryByRole("button", { name: /^priority$/i })).toBeNull();
    expect(options.getByRole("button", { name: /^list$/i })).toBeTruthy();
    expect(options.queryByRole("button", { name: /^context$/i })).toBeNull();
    expect(options.getByLabelText(/due date/i)).toBeTruthy();
  });

  it("compact: label handoff and cancellation preserve Options and unfinished task input", () => {
    const deferred = deferDialogCloseEvents();
    const onAdd = vi.fn();
    try {
      render(<AddForm serverLabels={{ list: ["work"], context: [] }} onAdd={onAdd} compact />);
      const input = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
      fireEvent.change(input, { target: { value: "unfinished task" } });
      fireEvent.click(screen.getByRole("button", { name: "Task options" }));
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
      fireEvent.click(screen.getByRole("button", { name: "List" }));
      const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
      fireEvent.click(within(picker).getByRole("button", { name: "work" }));
      deferred.flush();
      fireEvent.click(screen.getByRole("button", { name: "List" }));
      fireEvent.click(within(picker).getByRole("button", { name: /\+ add list/i }));
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
      expect(screen.getByRole("button", { name: "List" }).textContent).toBe("work");
      expect(onAdd).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "List" }));
      expect(picker.open).toBe(true);
    } finally {
      deferred.restore();
    }
  });

  it.each([false, true])("Cancel and list handoff preserve pending input under modeled activation (compact=%s)", (compact) => {
    const deferred = deferDialogCloseEvents();
    const handoffs = observeListHandoffs();
    const onAdd = vi.fn();
    try {
      render(<AddForm serverLabels={{ list: ["work"], context: [] }} onAdd={onAdd} compact={compact} />);
      const description = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
      fireEvent.change(description, { target: { value: "unfinished task" } });
      if (compact) fireEvent.click(screen.getByRole("button", { name: "Task options" }));
      fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-01" } });
      for (const [field, value] of [["List", "work"]]) {
        fireEvent.click(screen.getByRole("button", { name: field }));
        clickWithRemovedTargetLabelActivation(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: value }));
        deferred.flush();
        const trigger = screen.getByRole("button", { name: field });
        for (let cycle = 0; cycle < 2; cycle++) {
          fireEvent.click(trigger);
          const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
          clickWithRemovedTargetLabelActivation(within(picker).getByRole("button", { name: "Cancel" }));
          expect(picker.open).toBe(false);
          expect(trigger.textContent).toBe(value);
          // Deliver the old close only after an explicit reopening.
          fireEvent.click(trigger);
          deferred.flush();
          expect(picker.open).toBe(true);
          clickWithRemovedTargetLabelActivation(within(picker).getByRole("button", { name: "Cancel" }));
          deferred.flush();
          expect(picker.open).toBe(false);
        }
      }
      for (const action of ["Cancel", "Add"]) {
        fireEvent.click(screen.getByRole("button", { name: "List" }));
        const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
        clickWithRemovedTargetLabelActivation(within(picker).getByRole("button", { name: /\+ add list/i }));
        const label = document.getElementById("label-modal") as HTMLDialogElement;
        expect(picker.open).toBe(false);
        expect(label.open).toBe(true);
        deferred.flush();
        expect(label.open).toBe(true);
        const name = within(label).getByRole("textbox", { name: "New label name" });
        expect(document.activeElement).toBe(name);
        fireEvent.change(name, { target: { value: "garden" } });
        fireEvent.click(within(label).getByRole("button", { name: action }));
        deferred.flush();
        expect(label.open).toBe(false);
        expect(screen.getByRole("button", { name: "List" }).textContent).toBe(action === "Cancel" ? "work" : "garden");
      }
      expect(handoffs.pickerClosedAtOpen).toEqual([true, true]);
      expect(description.value).toBe("unfinished task");
      expect((screen.getByLabelText("Due date") as HTMLInputElement).value).toBe("2026-12-01");
      expect(screen.queryByRole("button", { name: "Priority" })).toBeNull();
      expect(onAdd).not.toHaveBeenCalled();
      if (compact) expect((document.querySelector("dialog.options-modal") as HTMLDialogElement).open).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "List" }));
      expect(within(document.querySelector("dialog.select-modal[open]")!).getByRole("button", { name: "garden" })).toBeTruthy();
    } finally {
      handoffs.restore();
      deferred.restore();
    }
  });
});
