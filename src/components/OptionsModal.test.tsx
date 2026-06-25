import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import OptionsModal from "./OptionsModal";

// The jsdom <dialog>.showModal()/close() polyfill lives in src/test/setup.ts (vitest setupFiles).

const isOpen = () => document.querySelector("dialog.options-modal[open]") !== null;
const openDialog = () => within(document.querySelector("dialog.options-modal[open]") as HTMLElement);

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); });

describe("OptionsModal", () => {
  it("shows an 'Options' trigger with the given accessible name", () => {
    render(<OptionsModal ariaLabel="Task options"><span>probe</span></OptionsModal>);
    const trigger = screen.getByRole("button", { name: /task options/i });
    expect(trigger.textContent).toBe("Options");
  });

  it("is closed until the trigger is clicked, then renders the passed children", () => {
    render(<OptionsModal ariaLabel="Task options"><button type="button">probe</button></OptionsModal>);
    expect(isOpen()).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    expect(isOpen()).toBe(true);
    expect(openDialog().getByRole("button", { name: "probe" })).toBeTruthy();
  });

  it("closes on Done", () => {
    render(<OptionsModal ariaLabel="Task options"><span>probe</span></OptionsModal>);
    fireEvent.click(screen.getByRole("button", { name: /task options/i }));
    fireEvent.click(openDialog().getByRole("button", { name: "Done" }));
    expect(isOpen()).toBe(false);
  });
});
