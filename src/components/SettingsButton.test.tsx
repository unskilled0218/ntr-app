import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import SettingsButton from "./SettingsButton";
import { setServerUrl } from "../settings";

// SettingsButton's only logic is the mode -> badge read, driven by getServerUrl() (real
// localStorage under jsdom), plus forwarding the click to onOpen.

beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  cleanup();
});

describe("SettingsButton", () => {
  it("shows [L] in local mode (no server URL)", () => {
    render(<SettingsButton onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /connection settings/i }).textContent).toBe("[L]");
  });

  it("shows [S] in server mode (a server URL is set)", () => {
    setServerUrl("https://example.test");
    render(<SettingsButton onOpen={vi.fn()} />);
    expect(screen.getByRole("button", { name: /connection settings/i }).textContent).toBe("[S]");
  });

  it("calls onOpen when clicked", () => {
    const onOpen = vi.fn();
    render(<SettingsButton onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /connection settings/i }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
