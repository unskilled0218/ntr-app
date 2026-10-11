import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SelectField, { type FieldOption } from "./SelectField";
import { cancelDialog, deferDialogCloseEvents } from "../test/dialog";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const OPTIONS: FieldOption[] = [
  { value: "", label: "All projects" },
  { value: "work", label: "work", removable: true },
  { value: "home", label: "home", removable: true },
];

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

// The single open picker dialog.
const openDialog = () => within(document.querySelector("dialog.select-modal[open]") as HTMLElement);

describe("SelectField", () => {
  it("shows the selected option's label on the trigger", () => {
    render(<SelectField ariaLabel="Project filter" value="work" options={OPTIONS} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /project filter/i }).textContent).toBe("work");
  });

  it("is closed until the trigger is clicked, then lists every option", () => {
    render(<SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    // The dialog carries the field's accessible name (matches the visible title).
    expect(screen.getByRole("dialog", { name: /project filter/i })).toBeTruthy();
    const dialog = openDialog();
    expect(dialog.getByRole("button", { name: "All projects" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "work" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "home" })).toBeTruthy();
  });

  it("calls onChange with the chosen value and closes the dialog", () => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    fireEvent.click(openDialog().getByRole("button", { name: "work" }));

    expect(onChange).toHaveBeenCalledWith("work");
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("shows a Remove button on removable rows and calls onRemove (closing the picker first)", () => {
    const onRemove = vi.fn();
    render(
      <SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={vi.fn()} onRemove={onRemove} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    const dialog = openDialog();
    // The "All projects" row is not removable; the label rows are.
    expect(dialog.queryByRole("button", { name: /remove all projects/i })).toBeNull();
    fireEvent.click(dialog.getByRole("button", { name: /remove work/i }));

    expect(onRemove).toHaveBeenCalledWith("work");
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("shows no Remove buttons when onRemove is not provided", () => {
    render(<SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    expect(openDialog().queryByRole("button", { name: /remove/i })).toBeNull();
  });

  // Backdrop dismissal (useBackdropClose via usePickerDialog) — also covers SortField/OptionsModal,
  // which share the same hook.
  it("closes when the backdrop (the dialog element itself) is clicked", () => {
    render(<SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLElement;
    expect(dialog.hasAttribute("open")).toBe(true);

    fireEvent.click(dialog); // e.target === dialog -> a backdrop click
    expect(document.querySelector("dialog.select-modal[open]")).toBeNull();
  });

  it("stays open when a click lands on inner content rather than the backdrop", () => {
    render(<SelectField ariaLabel="Project filter" value="" options={OPTIONS} onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /project filter/i }));
    fireEvent.click(openDialog().getByText("Project filter")); // the title <h2>, target !== dialog
    expect(document.querySelector("dialog.select-modal[open]")).not.toBeNull();
  });

  it.each(["Cancel", "native cancel"])("closes and reopens a standalone picker through %s", (method) => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="Project filter" value="work" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    if (method === "native cancel") cancelDialog(dialog);
    else fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(dialog.open).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    expect(dialog.open).toBe(true);
  });

  it("ignores a deferred close when its trigger has reopened the picker", () => {
    const deferred = deferDialogCloseEvents();
    try {
      render(<SelectField ariaLabel="Project filter" value="work" options={OPTIONS} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
      fireEvent.click(openDialog().getByRole("button", { name: "Cancel" }));
      fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
      deferred.flush();
      expect((document.querySelector("dialog.select-modal") as HTMLDialogElement).open).toBe(true);
      expect(openDialog().getByRole("button", { name: "work" })).toBeTruthy();
    } finally {
      deferred.restore();
    }
  });
});
