import { afterEach, describe, expect, it } from "vitest";
import { installZoomGestureGuard } from "./zoomGestures";

afterEach(() => { document.body.replaceChildren(); });

describe("zoom gesture guard", () => {
  it("cancels zoom wheels at nested targets but leaves other input alone", () => {
    const cleanup = installZoomGestureGuard(document);
    const scroll = document.createElement("div");
    const input = document.createElement("input");
    const dialog = document.createElement("dialog");
    scroll.append(input, dialog);
    document.body.append(scroll);
    for (const target of [scroll, input, dialog]) {
      for (const deltaY of [-10, 10]) {
        const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true, deltaY });
        target.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
      }
    }
    for (const event of [
      new WheelEvent("wheel", { bubbles: true, cancelable: true }),
      new WheelEvent("wheel", { bubbles: true, cancelable: true, shiftKey: true }),
      new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ctrlKey: true }),
      new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true }),
    ]) {
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    cleanup();
  });

  it("handles gesture cancellation, cleanup, and reinstallation", () => {
    const cleanup = installZoomGestureGuard(document);
    for (const name of ["gesturestart", "gesturechange"]) {
      const event = new Event(name, { bubbles: true, cancelable: true });
      document.body.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      const noncancelable = new Event(name, { bubbles: true });
      document.body.dispatchEvent(noncancelable);
      expect(noncancelable.defaultPrevented).toBe(false);
    }
    const noncancelableWheel = new WheelEvent("wheel", { bubbles: true, ctrlKey: true });
    document.body.dispatchEvent(noncancelableWheel);
    expect(noncancelableWheel.defaultPrevented).toBe(false);
    cleanup();
    cleanup();
    const dispatch = () => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(dispatch()).toBe(false);
    const again = installZoomGestureGuard(document);
    expect(dispatch()).toBe(true);
    again();
    expect(dispatch()).toBe(false);
  });
});
