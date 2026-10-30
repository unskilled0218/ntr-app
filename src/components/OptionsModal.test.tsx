import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OptionsModal from "./OptionsModal";
import SelectField from "./SelectField";
import SortField from "./SortField";
import { cancelDialog } from "../test/dialog";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const isOpen = () => document.querySelector("dialog.options-modal[open]") !== null;
const openDialog = () => within(document.querySelector("dialog.options-modal[open]") as HTMLElement);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("OptionsModal", () => {
  it("shows an 'Options' trigger with the given accessible name", () => {
    render(<OptionsModal ariaLabel="Task options"><span>probe</span></OptionsModal>);
    const trigger = screen.getByRole("button", { name: /task options/i });
    expect(trigger.textContent).toBe("Options");
  });

  it("is closed until the trigger is clicked, then renders the passed children", () => {
    render(<OptionsModal ariaLabel="Task options"><button type="button">probe</button></OptionsModal>);
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    expect(isOpen()).toBe(true);
    expect(openDialog().getByRole("button", { name: "probe" })).toBeTruthy();
  });

  it("closes on Done", () => {
    render(<OptionsModal ariaLabel="Task options"><span>probe</span></OptionsModal>);
    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    fireEvent.click(openDialog().getByRole("button", { name: "Done" }));
    expect(isOpen()).toBe(false);
  });

  it.each(["Cancel", "backdrop", "native cancel", "selection"])("dismisses only the nested picker through %s", (method) => {
    const onChange = vi.fn();
    render(
      <OptionsModal ariaLabel="Task options">
        <SelectField ariaLabel="Project" value="" options={[{ value: "work", label: "work" }]} onChange={onChange} />
      </OptionsModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    const child = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    if (method === "backdrop") fireEvent.click(child);
    else if (method === "native cancel") cancelDialog(child);
    else fireEvent.click(within(child).getByRole("button", { name: method === "selection" ? "work" : "Cancel" }));
    expect(child.open).toBe(false);
    expect(isOpen()).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(method === "selection" ? 1 : 0);
    fireEvent.click(screen.getByRole("button", { name: "Project" }));
    expect(child.open).toBe(true);
    cancelDialog(child);
    fireEvent.click(openDialog().getByRole("button", { name: "Done" }));
    expect(isOpen()).toBe(false);
  });

  it.each(["Done", "backdrop", "native cancel"])("keeps Options open when Sort closes through %s", (method) => {
    const onSort = vi.fn();
    const onDir = vi.fn();
    render(
      <OptionsModal ariaLabel="Filter options">
        <SortField sort="file" dir="asc" sortOptions={[{ value: "file", label: "File" }, { value: "due", label: "Due date" }]}
          dirOptions={[{ value: "asc", label: "ASC" }, { value: "desc", label: "DESC" }]} onSort={onSort} onDir={onDir} />
      </OptionsModal>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Filter options" }));
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const child = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    fireEvent.click(within(child).getByRole("button", { name: "Due date" }));
    fireEvent.click(within(child).getByRole("button", { name: "DESC" }));
    expect(child.open).toBe(true);
    expect(onSort).toHaveBeenCalledWith("due");
    expect(onDir).toHaveBeenCalledWith("desc");
    if (method === "backdrop") fireEvent.click(child);
    else if (method === "native cancel") cancelDialog(child);
    else fireEvent.click(within(child).getByRole("button", { name: "Done" }));
    expect(child.open).toBe(false);
    expect(isOpen()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(child.open).toBe(true);
  });

  it.each(["backdrop", "native cancel"])("dismisses standalone Options through %s", (method) => {
    render(<OptionsModal ariaLabel="Task options"><span>probe</span></OptionsModal>);
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    const dialog = document.querySelector("dialog.options-modal") as HTMLDialogElement;
    if (method === "backdrop") fireEvent.click(dialog);
    else cancelDialog(dialog);
    expect(isOpen()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Task options" }));
    expect(isOpen()).toBe(true);
  });
});
