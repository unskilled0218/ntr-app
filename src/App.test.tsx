import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardRef, StrictMode, useImperativeHandle } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import App from "./App";
import { activateTransport, onChange, reconcileWithServer } from "./api";
import { deferred, settle } from "./test/deferred";

const handles = vi.hoisted(() => ({ tasks: vi.fn(), note: vi.fn() }));
vi.mock("./components/NotePane", () => ({ default: forwardRef((_, ref) => {
  useImperativeHandle(ref, () => ({ onNoteChange: handles.note }));
  return <div>Note pane</div>;
}) }));
vi.mock("./components/TodoPane", () => ({ default: forwardRef((_, ref) => {
  useImperativeHandle(ref, () => ({ onTasksChanged: handles.tasks }));
  return <div>Task pane</div>;
}) }));
vi.mock("./components/SettingsModal", () => ({ default: ({ open, onClose }: { open: boolean; onClose: () => void }) =>
  open ? <button onClick={onClose}>Close settings</button> : null }));
vi.mock("./api", async (importOriginal) => ({
  ...await importOriginal<typeof import("./api")>(),
  onChange: vi.fn(),
  reconcileWithServer: vi.fn(),
  resolveConflict: vi.fn(),
  activateTransport: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(reconcileWithServer).mockResolvedValue([]);
  vi.mocked(onChange).mockResolvedValue(vi.fn());
});
afterEach(() => { cleanup(); localStorage.clear(); });

describe("App live subscription", () => {
  it("keeps zoom protection across view and settings changes and removes it on unmount", async () => {
    const { getByRole, getAllByRole, unmount } = render(<StrictMode><App /></StrictMode>);
    const zoom = () => {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ctrlKey: true });
      document.body.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(zoom()).toBe(true);
    await act(settle);
    fireEvent.click(getByRole("button", { name: "Todo" }));
    expect(zoom()).toBe(true);
    fireEvent.click(getAllByRole("button", { name: /settings/i })[0]);
    expect(zoom()).toBe(true);
    fireEvent.click(getByRole("button", { name: "Close settings" }));
    expect(zoom()).toBe(true);
    unmount();
    expect(zoom()).toBe(false);
  });

  it("navigates for horizontal single-touch swipes, not vertical or two-finger gestures", async () => {
    const realStyle = window.getComputedStyle;
    const style = vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudo) => {
      if (element.classList.contains("bottom-nav")) return { display: "flex" } as CSSStyleDeclaration;
      return realStyle(element, pseudo);
    });
    try {
      const { container } = render(<App />);
      await act(settle);
      const panes = container.querySelector(".panes")!;
      const main = container.querySelector("main")!;
      fireEvent.click(container.querySelector('button[data-view="note"]')!);
      const start = { clientX: 200, clientY: 100 };
      fireEvent.touchStart(panes, { touches: [start] });
      fireEvent.touchEnd(panes, { changedTouches: [{ clientX: 195, clientY: 0 }] });
      expect(main.dataset.view).toBe("note");
      fireEvent.touchStart(panes, { touches: [start] });
      fireEvent.touchStart(panes, { touches: [start, { clientX: 100, clientY: 100 }] });
      fireEvent.touchEnd(panes, { changedTouches: [{ clientX: 0, clientY: 100 }] });
      expect(main.dataset.view).toBe("note");
      fireEvent.touchStart(panes, { touches: [start] });
      fireEvent.touchEnd(panes, { changedTouches: [{ clientX: 0, clientY: 100 }] });
      expect(main.dataset.view).toBe("todo");
    } finally {
      style.mockRestore();
    }
  });
  it("refreshes both panes on connection and routes nearby changes independently", async () => {
    render(<App />);
    await act(settle);
    const [changed, options] = vi.mocked(onChange).mock.calls[0];
    act(() => options!.onConnected!());
    expect(handles.tasks).toHaveBeenCalledTimes(1);
    expect(handles.note).toHaveBeenCalledTimes(1);
    act(() => { changed("tasks"); changed("note"); });
    expect(handles.tasks).toHaveBeenCalledTimes(2);
    expect(handles.note).toHaveBeenCalledTimes(2);
    expect(reconcileWithServer).toHaveBeenCalledTimes(1); // no startup upload on reconnect
  });

  it("aborts StrictMode's pending setup and cleans its late listener", async () => {
    const pending = deferred<() => void>();
    const oldCleanup = vi.fn();
    vi.mocked(onChange).mockReturnValueOnce(pending.promise);
    const { unmount } = render(<StrictMode><App /></StrictMode>);
    const first = vi.mocked(onChange).mock.calls[0][1]!.signal!;
    expect(first.aborted).toBe(true);
    await act(async () => { pending.resolve(oldCleanup); await settle(); });
    expect(oldCleanup).toHaveBeenCalledTimes(1);
    const current = vi.mocked(onChange).mock.calls[1][1]!.signal!;
    expect(current.aborted).toBe(false);
    unmount();
    expect(current.aborted).toBe(true);
  });

  it("leaves unchanged settings, subscriptions, and panes untouched", async () => {
    const { getAllByRole, getByRole } = render(<App />);
    await act(settle);
    const old = vi.mocked(onChange).mock.calls[0][1]!.signal!;
    fireEvent.click(getAllByRole("button", { name: /settings/i })[0]);
    fireEvent.click(getByRole("button", { name: "Close settings" }));
    await act(settle);
    expect(activateTransport).not.toHaveBeenCalled();
    expect(old.aborted).toBe(false);
    expect(handles.tasks).not.toHaveBeenCalled();
    expect(handles.note).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("handles subscription setup failure without an unhandled rejection", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(onChange).mockRejectedValueOnce(new Error("listener unavailable"));
    render(<App />);
    await act(settle);
    expect(warn).toHaveBeenCalledWith("live subscription failed:", expect.any(Error));
    warn.mockRestore();
  });
});
