import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, createEvent, fireEvent, render } from "@testing-library/react";
import { LONG_PRESS_MS } from "../config";
import { useLinkGestures } from "./useLinkGestures";

// Mock the open seam so gestures are observable without a Tauri runtime.
const openLink = vi.fn<(url: string) => void>();
vi.mock("../lib/openLink", () => ({ openLink: (url: string) => openLink(url) }));

const URL = "https://x.io";

// A probe that spreads the gesture handlers onto a div containing a link, and surfaces `pending` so the
// long-press path is observable.
function Probe() {
  const links = useLinkGestures();
  return (
    <div data-testid="surface" {...links.handlers}>
      <a className="md-link" data-href={URL}>
        docs
      </a>
      <span data-testid="pending">{links.pending ?? ""}</span>
    </div>
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  openLink.mockReset();
});

const link = () => document.querySelector("a.md-link")!;
const pending = () => document.querySelector('[data-testid="pending"]')!.textContent;

// jsdom has no PointerEvent, so pointerType is not carried by fireEvent's init; set it explicitly on the
// event so the handler's `e.pointerType` check sees the real gesture.
function pointer(kind: "Down" | "Up" | "Move", node: Element, pointerType: string) {
  const ev = createEvent[`pointer${kind}`](node);
  Object.defineProperty(ev, "pointerType", { value: pointerType });
  fireEvent(node, ev);
}

describe("useLinkGestures", () => {
  it("opens on Ctrl-click and Cmd-click of a link, but not on a plain click", () => {
    render(<Probe />);
    fireEvent.click(link()); // plain
    expect(openLink).not.toHaveBeenCalled();
    fireEvent.click(link(), { ctrlKey: true });
    fireEvent.click(link(), { metaKey: true });
    expect(openLink.mock.calls).toEqual([[URL], [URL]]);
  });

  it("does not open a modifier-click that is not on a link", () => {
    const { getByTestId } = render(<Probe />);
    fireEvent.click(getByTestId("surface"), { ctrlKey: true });
    expect(openLink).not.toHaveBeenCalled();
  });

  it("raises the pending modal after a touch held LONG_PRESS_MS", () => {
    render(<Probe />);
    pointer("Down", link(), "touch");
    expect(pending()).toBe(""); // not yet
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(pending()).toBe(URL);
  });

  it("aborts the long-press when the finger lifts or moves before the threshold", () => {
    render(<Probe />);
    pointer("Down", link(), "touch");
    pointer("Up", link(), "touch");
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(pending()).toBe("");

    pointer("Down", link(), "touch");
    pointer("Move", link(), "touch");
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(pending()).toBe("");
  });

  it("ignores a non-touch pointerdown (mouse uses the modifier-click path)", () => {
    render(<Probe />);
    pointer("Down", link(), "mouse");
    act(() => vi.advanceTimersByTime(LONG_PRESS_MS));
    expect(pending()).toBe("");
  });
});
