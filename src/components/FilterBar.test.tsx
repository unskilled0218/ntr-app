import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import FilterBar from "./FilterBar";
import { REMOVE_VALUE } from "../config";

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

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("FilterBar remove option", () => {
  it("offers no Remove button (the action moved inside the dropdown)", () => {
    renderBar({ project: "work", context: "phone" });
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("hides the Remove option while the filter is 'All' (no specific label)", () => {
    renderBar({ project: "", context: "" });
    const projectSelect = screen.getByRole("combobox", { name: /project filter/i });
    const contextSelect = screen.getByRole("combobox", { name: /context filter/i });
    expect(within(projectSelect).queryByRole("option", { name: /remove/i })).toBeNull();
    expect(within(contextSelect).queryByRole("option", { name: /remove/i })).toBeNull();
  });

  it("offers a Remove option for the selected project and dispatches onRemove (not onProject)", () => {
    const { onRemove, onProject } = renderBar({ project: "work" });
    const projectSelect = screen.getByRole("combobox", { name: /project filter/i });
    expect(within(projectSelect).getByRole("option", { name: /remove \+work/i })).toBeTruthy();
    fireEvent.change(projectSelect, { target: { value: REMOVE_VALUE } });
    expect(onRemove).toHaveBeenCalledWith("project", "work");
    expect(onProject).not.toHaveBeenCalled();
  });

  it("dispatches onRemove for the selected context", () => {
    const { onRemove } = renderBar({ context: "phone" });
    const contextSelect = screen.getByRole("combobox", { name: /context filter/i });
    expect(within(contextSelect).getByRole("option", { name: /remove @phone/i })).toBeTruthy();
    fireEvent.change(contextSelect, { target: { value: REMOVE_VALUE } });
    expect(onRemove).toHaveBeenCalledWith("context", "phone");
  });

  it("still treats a normal selection as a filter change, not a removal", () => {
    const { onRemove, onProject } = renderBar({ project: "work" });
    fireEvent.change(screen.getByRole("combobox", { name: /project filter/i }), {
      target: { value: "home" },
    });
    expect(onProject).toHaveBeenCalledWith("home");
    expect(onRemove).not.toHaveBeenCalled();
  });
});
