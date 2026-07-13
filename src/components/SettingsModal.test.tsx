import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import { getStartupView, setCompactUi, setConflictStrategy, setStartupView, type StartupView } from "../settings";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const settingsState = vi.hoisted(() => ({
  startupView: "note" as "note" | "todo" | "last",
}));

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
  getStartupView: () => settingsState.startupView,
  setStartupView: vi.fn((v: StartupView) => {
    settingsState.startupView = v;
  }),
  getConflictStrategy: () => "ask",
  setConflictStrategy: vi.fn(),
}));

beforeEach(() => {
  settingsState.startupView = "note";
  vi.clearAllMocks();
});
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

describe("SettingsModal startup-page picker", () => {
  it("persists the chosen startup page and shows it on the trigger", () => {
    render(<SettingsModal open onClose={vi.fn()} />);

    const trigger = screen.getByRole("button", { name: /startup page/i });
    expect(trigger.textContent).toBe("Note");

    fireEvent.click(trigger);
    const picker = within(document.querySelector("dialog.select-modal[open]") as HTMLElement);
    fireEvent.click(picker.getByRole("button", { name: /last opened/i }));

    expect(vi.mocked(setStartupView)).toHaveBeenCalledWith("last");
    expect(getStartupView()).toBe("last");
    expect(trigger.textContent).toBe("Last opened");
  });

  it("seeds the picker from the stored startup page", () => {
    setStartupView("todo");
    vi.mocked(setStartupView).mockClear();

    render(<SettingsModal open onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /startup page/i }).textContent).toBe("Todo");
    expect(setStartupView).not.toHaveBeenCalled();
  });
});

describe("SettingsModal backdrop close", () => {
  // The state-driven override path: a backdrop click routes through onClose (not a raw
  // dialog.close()), so the parent keeps control of the `open` prop, exactly as Escape does.
  it("calls onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    render(<SettingsModal open onClose={onClose} />);

    const dialog = document.getElementById("settings-modal") as HTMLDialogElement;
    fireEvent.click(dialog); // e.target === dialog -> a backdrop click
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays put when a click lands on inner content rather than the backdrop", () => {
    const onClose = vi.fn();
    render(<SettingsModal open onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /on conflict/i })); // inner trigger
    expect(onClose).not.toHaveBeenCalled();
  });
});
