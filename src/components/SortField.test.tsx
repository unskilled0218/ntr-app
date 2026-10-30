import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SortField from "./SortField";
import type { FieldOption } from "./PickerList";
import { cancelDialog } from "../test/dialog";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const SORT_OPTIONS: FieldOption[] = [
  { value: "file", label: "File order" },
  { value: "due", label: "Due date" },
  { value: "created", label: "Created" },
  { value: "projects", label: "Projects" },
];
const DIR_OPTIONS: FieldOption[] = [
  { value: "asc", label: "ASC" },
  { value: "desc", label: "DESC" },
];

function renderField(overrides: Partial<Parameters<typeof SortField>[0]> = {}) {
  const onSort = vi.fn();
  const onDir = vi.fn();
  render(
    <SortField
      sort="file"
      dir="asc"
      sortOptions={SORT_OPTIONS}
      dirOptions={DIR_OPTIONS}
      onSort={onSort}
      onDir={onDir}
      {...overrides}
    />,
  );
  return { onSort, onDir };
}

const openDialog = () => within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
const isOpen = () => document.querySelector("dialog.select-modal[open]") !== null;

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("SortField", () => {
  it("has a 'Sort' trigger showing the current sort and direction", () => {
    renderField({ sort: "due", dir: "desc" });
    expect(screen.getByRole("button", { name: "Sort" }).textContent).toBe("Due date · DESC");
  });

  it("is closed until the trigger is clicked, then shows both the sort and direction options", () => {
    renderField();
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const dialog = openDialog();
    // Sort keys (incl. the task-16 additions, no A-Z) ...
    expect(dialog.getByRole("button", { name: "Projects" })).toBeTruthy();
    expect(dialog.queryByRole("button", { name: "Contexts" })).toBeNull();
    expect(dialog.queryByRole("button", { name: "Priority" })).toBeNull();
    expect(dialog.queryByRole("button", { name: /^a-z$/i })).toBeNull();
    // ... and the directions, in the same modal.
    expect(dialog.getByRole("button", { name: "ASC" })).toBeTruthy();
    expect(dialog.getByRole("button", { name: "DESC" })).toBeTruthy();
  });

  it("marks the current sort and direction rows", () => {
    renderField({ sort: "due", dir: "desc" });
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const dialog = openDialog();
    expect(dialog.getByRole("button", { name: "Due date" }).getAttribute("aria-current")).toBe("true");
    expect(dialog.getByRole("button", { name: "DESC" }).getAttribute("aria-current")).toBe("true");
  });

  it("applies a sort pick without closing, so direction can be set in the same visit", () => {
    const { onSort, onDir } = renderField();
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));

    fireEvent.click(openDialog().getByRole("button", { name: "Projects" }));
    expect(onSort).toHaveBeenCalledWith("projects");
    // Still open: the whole point of one modal is to set both choices.
    expect(isOpen()).toBe(true);

    fireEvent.click(openDialog().getByRole("button", { name: "DESC" }));
    expect(onDir).toHaveBeenCalledWith("desc");
    expect(isOpen()).toBe(true);
  });

  it("closes on Done", () => {
    renderField();
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    fireEvent.click(openDialog().getByRole("button", { name: "Done" }));
    expect(isOpen()).toBe(false);
  });

  it.each(["backdrop", "native cancel"])("closes standalone Sort through %s without changing values", (method) => {
    const { onSort, onDir } = renderField();
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    const dialog = document.querySelector("dialog.select-modal") as HTMLDialogElement;
    if (method === "backdrop") fireEvent.click(dialog);
    else cancelDialog(dialog);
    expect(isOpen()).toBe(false);
    expect(onSort).not.toHaveBeenCalled();
    expect(onDir).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sort" }));
    expect(isOpen()).toBe(true);
  });
});
