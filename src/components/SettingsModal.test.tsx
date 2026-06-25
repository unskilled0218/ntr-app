import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import { setCompactUi, setConflictStrategy } from "../settings";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

vi.mock("../api", () => ({
  getDataDir: vi.fn().mockResolvedValue(""),
  setDataDir: vi.fn(),
}));

vi.mock("../settings", () => ({
  getServerUrl: () => "",
  setServerUrl: vi.fn(),
  getAllowInvalidCert: () => false,
  setAllowInvalidCert: vi.fn(),
  getCompactUi: () => false,
  setCompactUi: vi.fn(),
  getConflictStrategy: () => "ask",
  setConflictStrategy: vi.fn(),
}));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("SettingsModal conflict-strategy picker", () => {
  it("persists the chosen strategy and shows it on the trigger", () => {
    render(<SettingsModal open onClose={vi.fn()} />);

    // The trigger starts on the stored strategy ("ask").
    const trigger = screen.getByRole("button", { name: /on conflict/i });
    expect(trigger.textContent).toBe("Ask every time");

    fireEvent.click(trigger);
    const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    fireEvent.click(picker.getByRole("button", { name: /always use server/i }));

    expect(vi.mocked(setConflictStrategy)).toHaveBeenCalledWith("server");
    expect(trigger.textContent).toBe("Always use server");
  });
});

describe("SettingsModal compact-controls toggle", () => {
  it("persists the compact-controls choice when toggled", () => {
    render(<SettingsModal open onClose={vi.fn()} />);

    const checkbox = screen.getByRole("checkbox", { name: /compact controls/i }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false); // seeded from getCompactUi() = false

    fireEvent.click(checkbox);
    expect(vi.mocked(setCompactUi)).toHaveBeenCalledWith(true);
    expect(checkbox.checked).toBe(true);
  });
});
