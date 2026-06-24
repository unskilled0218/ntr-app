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
  render(
    <FilterBar
      status="all"
      project=""
      context=""
      sort="file"
      serverLabels={SERVER_LABELS}
      onStatus={vi.fn()}
      onProject={onProject}
      onContext={onContext}
      onSort={vi.fn()}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onRemove, onProject, onContext };
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
    expect(openPicker(/sort order/i).queryByRole("button", { name: /remove/i })).toBeNull();
  });
});
