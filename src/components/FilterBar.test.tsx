import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FilterBar from "./FilterBar";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const SERVER_LABELS = { project: ["work", "home"], context: ["phone", "store"] };

// FilterBar is pure props — no api dependency to mock.
function renderBar(overrides: Partial<ComponentProps<typeof FilterBar>> = {}) {
  const onRemove = vi.fn();
  const onProject = vi.fn();
  const onContext = vi.fn();
  const onSort = vi.fn();
  const onDir = vi.fn();
  render(
    <FilterBar
      status="all"
      project=""
      context=""
      sort="file"
      dir="asc"
      compact={false}
      serverLabels={SERVER_LABELS}
      onStatus={vi.fn()}
      onProject={onProject}
      onContext={onContext}
      onSort={onSort}
      onDir={onDir}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onRemove, onProject, onContext, onSort, onDir };
}

const openDialog = () => within(document.querySelector("dialog.select-modal[open]") as HTMLElement);

function openPicker(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  return openDialog();
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("FilterBar pickers", () => {
  it("lists the project labels and calls onProject when one is chosen", () => {
    const { onProject } = renderBar();
    const picker = openPicker(/project filter/i);
    expect(picker.getByRole("button", { name: "work" })).toBeTruthy();
    expect(picker.getByRole("button", { name: "home" })).toBeTruthy();
    fireEvent.click(picker.getByRole("button", { name: "home" }));
    expect(onProject).toHaveBeenCalledWith("home");
  });

  it("offers a Remove button on each label row and calls onRemove with the kind and name", () => {
    const { onRemove } = renderBar();
    const picker = openPicker(/project filter/i);
    // The "All projects" row is not removable.
    expect(picker.queryByRole("button", { name: /remove all projects/i })).toBeNull();
    fireEvent.click(picker.getByRole("button", { name: /remove work/i }));
    expect(onRemove).toHaveBeenCalledWith("project", "work");
  });

  it("removes a context label from the context picker", () => {
    const { onRemove } = renderBar();
    const picker = openPicker(/context filter/i);
    fireEvent.click(picker.getByRole("button", { name: /remove phone/i }));
    expect(onRemove).toHaveBeenCalledWith("context", "phone");
  });

  it("does not offer Remove on the Status or Sort pickers", () => {
    renderBar();
    expect(openPicker(/status filter/i).queryByRole("button", { name: /remove/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(openPicker(/^sort$/i).queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("holds the sort keys and the directions in one Sort modal and reports each pick", () => {
    const { onSort, onDir } = renderBar();
    const picker = openPicker(/^sort$/i);
    // Sort keys (with the task-16 additions, no A-Z) and directions live in the same modal.
    expect(picker.getByRole("button", { name: "Projects" })).toBeTruthy();
    expect(picker.getByRole("button", { name: "Contexts" })).toBeTruthy();
    expect(picker.queryByRole("button", { name: /^a-z$/i })).toBeNull();
    expect(picker.getByRole("button", { name: "ASC" })).toBeTruthy();

    fireEvent.click(picker.getByRole("button", { name: "Projects" }));
    expect(onSort).toHaveBeenCalledWith("projects");
    // The modal stays open, so the direction can be chosen in the same visit.
    fireEvent.click(openDialog().getByRole("button", { name: "DESC" }));
    expect(onDir).toHaveBeenCalledWith("desc");
  });

  it("compact: collapses the choosers behind one Options button that still drives them", () => {
    const { onSort } = renderBar({ compact: true });
    // The choosers are not inline; only the Options trigger is.
    expect(screen.queryByRole("button", { name: /status filter/i })).toBeNull();
    expect(screen.getByRole("button", { name: /filter options/i })).toBeTruthy();

    // Open the Options modal: the four choosers live inside it.
    fireEvent.click(screen.getByRole("button", { name: /filter options/i }));
    const options = within(document.querySelector("dialog.options-modal[open]") as HTMLElement);
    expect(options.getByRole("button", { name: /status filter/i })).toBeTruthy();
    expect(options.getByRole("button", { name: /^sort$/i })).toBeTruthy();

    // A chooser opened from inside the Options modal still works.
    fireEvent.click(options.getByRole("button", { name: /^sort$/i }));
    fireEvent.click(openDialog().getByRole("button", { name: "Projects" }));
    expect(onSort).toHaveBeenCalledWith("projects");
  });
});
