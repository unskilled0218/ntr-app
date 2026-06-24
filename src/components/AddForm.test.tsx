import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import AddForm from "./AddForm";

const EMPTY_LABELS = { project: [], context: [] };

beforeAll(() => {
  // jsdom does not implement <dialog>.showModal()/close(); the same stub EditTaskModal.test uses.
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// Open the label modal for `kind` and confirm `name` through it. Scoped to #label-modal because
// the add form has its own "Add" submit button with the same text.
function addLabelViaModal(kind: "project" | "context", name: string) {
  const select = screen.getByRole("combobox", {
    name: kind === "project" ? /^project$/i : /^context$/i,
  });
  fireEvent.change(select, { target: { value: "+add" } });
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
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} />);

    fireEvent.change(screen.getByRole("textbox", { name: /new task/i }), {
      target: { value: "water plants" },
    });
    addLabelViaModal("project", "garden");

    const project = screen.getByRole("combobox", { name: /^project$/i }) as HTMLSelectElement;
    expect(project.value).toBe("garden");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("adding a context from the modal does not fire onAdd even with an empty description", () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} />);

    addLabelViaModal("context", "errands");

    const context = screen.getByRole("combobox", { name: /^context$/i }) as HTMLSelectElement;
    expect(context.value).toBe("errands");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("submitting a task calls onAdd with the composed text and resets the form", async () => {
    const onAdd = vi.fn().mockResolvedValue(true);
    render(<AddForm serverLabels={EMPTY_LABELS} onAdd={onAdd} />);

    const input = screen.getByRole("textbox", { name: /new task/i }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "call bank" } });
    // Both the form and the (always-rendered) label modal have an "Add" button; scope to the form.
    const form = within(document.getElementById("add-form") as HTMLElement);
    fireEvent.click(form.getByRole("button", { name: /^add$/i }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith("call bank"));
    await waitFor(() => expect(input.value).toBe(""));
  });
});
