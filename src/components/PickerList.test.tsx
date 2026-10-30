import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import PickerList, { optionLabel, type FieldOption } from "./PickerList";

// The selectable-row contract that both SelectField and SortField now depend on.

const OPTIONS: FieldOption[] = [
  { value: "", label: "All projects" },
  { value: "work", label: "work", removable: true },
  { value: "home", label: "home", removable: true },
];

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("PickerList", () => {
  it("uses keyboard-native icon buttons without submitting a form or choosing a project", () => {
    const onChoose = vi.fn(), onRename = vi.fn(), onRemove = vi.fn(), onSubmit = vi.fn();
    render(<form onSubmit={onSubmit}><PickerList options={[{ value: "work", label: "work", renamable: true, removable: true, description: "Unfinished rename" }]}
      value="" onChoose={onChoose} onRename={onRename} onRemove={onRemove} /></form>);
    for (const name of ["Rename work", "Remove work"]) {
      const button = screen.getByRole("button", { name });
      expect(button.getAttribute("type")).toBe("button"); expect(button.textContent).toBe("");
      expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(button.getAttribute("aria-describedby")).toBeTruthy();
      button.focus(); expect(document.activeElement).toBe(button);
      fireEvent.click(button, { detail: 0 }); // The click shape emitted by native keyboard activation.
    }
    expect(onRename).toHaveBeenCalledWith("work"); expect(onRemove).toHaveBeenCalledWith("work");
    expect(onChoose).not.toHaveBeenCalled(); expect(onSubmit).not.toHaveBeenCalled();
  });
  it("renders one choice button per option", () => {
    render(<PickerList options={OPTIONS} value="" onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "All projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "work" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "home" })).toBeTruthy();
  });

  it("marks the row whose value equals value with aria-current", () => {
    render(<PickerList options={OPTIONS} value="work" onChoose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "work" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "home" }).getAttribute("aria-current")).toBeNull();
  });

  it("calls onChoose with the clicked row's value", () => {
    const onChoose = vi.fn();
    render(<PickerList options={OPTIONS} value="" onChoose={onChoose} />);
    fireEvent.click(screen.getByRole("button", { name: "home" }));
    expect(onChoose).toHaveBeenCalledWith("home");
  });

  it("shows Remove only on removable rows and only when onRemove is passed", () => {
    const onRemove = vi.fn();
    render(<PickerList options={OPTIONS} value="" onChoose={vi.fn()} onRemove={onRemove} />);
    // "All projects" is not removable; the label rows are.
    expect(screen.queryByRole("button", { name: /remove all projects/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /remove work/i }));
    expect(onRemove).toHaveBeenCalledWith("work");
  });

  it("shows no Remove buttons when onRemove is omitted", () => {
    render(<PickerList options={OPTIONS} value="" onChoose={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });
});

describe("optionLabel", () => {
  it("returns the matching option's label", () => {
    expect(optionLabel(OPTIONS, "work")).toBe("work");
  });

  it("falls back to the first option's label when the value matches none", () => {
    expect(optionLabel(OPTIONS, "missing")).toBe("All projects");
  });

  it("returns an empty string when there are no options", () => {
    expect(optionLabel([], "anything")).toBe("");
  });
});
