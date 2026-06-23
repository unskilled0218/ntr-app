import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import NotePane, { type NotePaneHandle } from "./NotePane";

// Mock only the transport seam (api.ts). getNote/putNote are controllable; errMsg stays real.
const getNote = vi.fn<() => Promise<string>>();
const putNote = vi.fn<(t: string) => Promise<void>>();
vi.mock("../api", () => ({
  getNote: () => getNote(),
  putNote: (t: string) => putNote(t),
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// jsdom doesn't implement <dialog>.showModal/close; provide minimal versions so the conflict
// dialog can open/close and still fire its `close` event.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  getNote.mockReset();
  putNote.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// Flush pending microtasks (promise continuations) without firing the autosave timer.
async function flushMicrotasks() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

// Enter text via the paste path — the deterministic way to write a contenteditable in jsdom (a
// synthetic `input` does not mutate it). spliceNote arms the same autosave debounce typing does.
function pasteInto(editor: Element, text: string) {
  fireEvent.paste(editor, { clipboardData: { getData: () => text } });
}

describe("NotePane autosave", () => {
  it("debounced-saves the entered text and shows Saved", async () => {
    getNote.mockResolvedValue("");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks(); // initial loadNote()

    const editor = container.querySelector("#note-input")!;
    pasteInto(editor, "hello note");

    // Let the debounce fire and the PUT resolve.
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(putNote).toHaveBeenCalledTimes(1);
    expect(putNote).toHaveBeenCalledWith("hello note");
    expect(container.querySelector("#note-status")!.textContent).toBe("Saved");
  });
});

describe("NotePane conflict resolution", () => {
  it("keep-mine saves the local text over the rebased remote", async () => {
    getNote.mockResolvedValue("base");
    const ref = createRef<NotePaneHandle>();
    const { container, getByText } = render(<NotePane ref={ref} />);
    await flushMicrotasks(); // load "base"

    const editor = container.querySelector("#note-input")!;
    pasteInto(editor, "X"); // local is now "baseX", dirty against saved "base"

    // A remote change arrives while we have unsaved edits → conflict.
    getNote.mockResolvedValue("theirs");
    await act(async () => {
      ref.current!.onNoteChange();
      for (let i = 0; i < 5; i++) await Promise.resolve(); // flush reconcile, no timers
    });

    // The conflict dialog is open; choose Keep mine.
    const keepMine = getByText("Keep mine");
    fireEvent.click(keepMine);
    await flushMicrotasks();

    // Mine wins: the local text is PUT (over the now-rebased remote base).
    expect(putNote).toHaveBeenCalledWith("baseX");
  });
});
