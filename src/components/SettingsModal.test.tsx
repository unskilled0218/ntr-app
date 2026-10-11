import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import SettingsModal from "./SettingsModal";
import { useState } from "react";
import { cancelDialog } from "../test/dialog";
import { getDataDir, getStorageKind, pickDataDir, setDataDir } from "../api";
import { getStartupView, setCompactUi, setConflictStrategy, setStartupView, type StartupView } from "../settings";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const settingsState = vi.hoisted(() => ({
  startupView: "note" as "note" | "todo" | "last",
}));

vi.mock("../api", () => ({
  getDataDir: vi.fn().mockResolvedValue(""),
  getStorageKind: vi.fn().mockResolvedValue("path"),
  pickDataDir: vi.fn(),
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
  vi.mocked(getDataDir).mockResolvedValue("");
  vi.mocked(getStorageKind).mockResolvedValue("path");
  vi.mocked(pickDataDir).mockResolvedValue(null);
  vi.mocked(setDataDir).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); });

describe("SettingsModal data-directory picker", () => {
  it("fills the editable path input on desktop and waits for Save path", async () => {
    vi.mocked(getDataDir).mockResolvedValue("/old");
    vi.mocked(pickDataDir).mockResolvedValue("/picked");
    render(<SettingsModal open onClose={vi.fn()} />);

    const input = await screen.findByDisplayValue("/old");
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    await waitFor(() => expect((input as HTMLInputElement).value).toBe("/picked"));
    expect(setDataDir).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /save path/i }));
    await waitFor(() => expect(setDataDir).toHaveBeenCalledWith("/picked"));
  });

  it("applies a picked SAF folder immediately", async () => {
    const onClose = vi.fn();
    vi.mocked(getDataDir).mockResolvedValue("Notes");
    vi.mocked(getStorageKind).mockResolvedValue("saf");
    vi.mocked(pickDataDir).mockResolvedValue("content://tree/notes");
    render(<SettingsModal open onClose={onClose} />);

    expect(await screen.findByText("Notes")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /save path/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    await waitFor(() => expect(setDataDir).toHaveBeenCalledWith("content://tree/notes"));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves the current path alone when folder picking is cancelled", async () => {
    vi.mocked(getDataDir).mockResolvedValue("/old");
    vi.mocked(pickDataDir).mockResolvedValue(null);
    render(<SettingsModal open onClose={vi.fn()} />);

    const input = await screen.findByDisplayValue("/old");
    fireEvent.click(screen.getByRole("button", { name: /choose folder/i }));

    await waitFor(() => expect(pickDataDir).toHaveBeenCalled());
    expect((input as HTMLInputElement).value).toBe("/old");
    expect(setDataDir).not.toHaveBeenCalled();
  });
});

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

describe("SettingsModal nested dismissal", () => {
  it.each(["Cancel", "backdrop", "native cancel", "selection"])("retains Settings input when a picker closes through %s", async (method) => {
    const onClose = vi.fn();
    function Owner() {
      const [open, setOpen] = useState(true);
      return <SettingsModal open={open} onClose={() => { onClose(); setOpen(false); }} />;
    }
    render(<Owner />);
    await waitFor(() => expect(getDataDir).toHaveBeenCalled());
    const input = screen.getByRole("textbox", { name: "Server URL" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "https://pending.example" } });
    fireEvent.click(screen.getByRole("button", { name: "Startup page" }));
    const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
    if (method === "native cancel") expect(cancelDialog(picker).defaultPrevented).toBe(false);
    else if (method === "backdrop") fireEvent.click(picker);
    else fireEvent.click(within(picker).getByRole("button", { name: method === "selection" ? "Todo" : "Cancel" }));
    expect(picker.open).toBe(false);
    expect((document.getElementById("settings-modal") as HTMLDialogElement).open).toBe(true);
    expect(input.value).toBe("https://pending.example");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Startup page" }));
    expect(picker.open).toBe(true);
    cancelDialog(picker);
    cancelDialog(document.getElementById("settings-modal") as HTMLDialogElement);
    expect(onClose).toHaveBeenCalledOnce();
    expect((document.getElementById("settings-modal") as HTMLDialogElement).open).toBe(false);
  });
});
