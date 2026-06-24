import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import FilterBar from "./FilterBar";

const SERVER_LABELS = { project: ["work", "home"], context: ["phone", "store"] };

// FilterBar is pure props — no api dependency to mock.
function renderBar(overrides: Partial<ComponentProps<typeof FilterBar>> = {}) {
  const onRemove = vi.fn();
  render(
    <FilterBar
      status="all"
      project=""
      context=""
      sort="file"
      serverLabels={SERVER_LABELS}
      onStatus={vi.fn()}
      onProject={vi.fn()}
      onContext={vi.fn()}
      onSort={vi.fn()}
      onRemove={onRemove}
      {...overrides}
    />,
  );
  return { onRemove };
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("FilterBar remove buttons", () => {
  it("disables Remove while the filter is 'All' (no specific label selected)", () => {
    renderBar({ project: "", context: "" });
    expect((screen.getByRole("button", { name: /remove project/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /remove context/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables Remove and calls onRemove with the selected project", () => {
    const { onRemove } = renderBar({ project: "work" });
    const btn = screen.getByRole("button", { name: /remove project/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onRemove).toHaveBeenCalledWith("project", "work");
  });

  it("calls onRemove with the selected context", () => {
    const { onRemove } = renderBar({ context: "phone" });
    fireEvent.click(screen.getByRole("button", { name: /remove context/i }));
    expect(onRemove).toHaveBeenCalledWith("context", "phone");
  });
});
