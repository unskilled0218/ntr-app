import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef, StrictMode } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import NotePane, { type NotePaneHandle } from "./NotePane";
import { getCaretRange, readNoteText, setCaret, setCaretRange, setEditorText } from "../lib/caret";
import { activateTransport, type TransportContext } from "../api";
import { deferred, settle } from "../test/deferred";

// Mock only the transport seam (api.ts). getNote/putNote are controllable; errMsg stays real.
const getNote = vi.fn<() => Promise<string>>();
const putNote = vi.fn<(t: string) => Promise<void>>();
const noteReads = vi.fn<(context: TransportContext) => void>();
const noteWrites = vi.fn<(text: string, context: TransportContext) => void>();
vi.mock("../api", async (importOriginal) => ({
  ...await importOriginal<typeof import("../api")>(),
  getNote: (context: TransportContext) => { noteReads(context); return getNote(); },
  putNote: (t: string, context: TransportContext) => { noteWrites(t, context); return putNote(t); },
  errMsg: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  getNote.mockReset();
  putNote.mockReset().mockResolvedValue(undefined);
  noteReads.mockReset();
  noteWrites.mockReset();
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

function keyDown(editor: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  fireEvent(editor, event);
  return event;
}

function composingKeyDown(editor: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  Object.defineProperty(event, "isComposing", { value: true });
  fireEvent(editor, event);
  return event;
}

function updateComposition(editor: HTMLDivElement, text: string) {
  const line = editor.firstElementChild!;
  line.textContent = text;
  setCaret(editor, text.length);
  fireEvent.input(editor, { data: text, inputType: "insertCompositionText", isComposing: true });
  return line;
}

function selectText(root: HTMLElement, start: number, end: number) {
  setCaret(root, start);
  const range = document.createRange();
  const startRange = window.getSelection()!.getRangeAt(0);
  range.setStart(startRange.startContainer, startRange.startOffset);
  setCaret(root, end);
  const endRange = window.getSelection()!.getRangeAt(0);
  range.setEnd(endRange.startContainer, endRange.startOffset);
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  sel.addRange(range);
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

describe("NotePane text key handling", () => {
  it("inserts Space into the current line without creating another line", async () => {
    getNote.mockResolvedValue("ab\ncd");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 1);
    const event = keyDown(editor, " ");

    expect(event.defaultPrevented).toBe(true);
    expect(readNoteText(editor)).toBe("a b\ncd");
    expect(editor.children).toHaveLength(2);
  });

  it("keeps a Space typed on an otherwise empty note and saves it", async () => {
    getNote.mockResolvedValue("");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 0);
    keyDown(editor, " ");

    expect(readNoteText(editor)).toBe(" ");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).toHaveBeenCalledWith(" ");
  });

  it("inserts Tab at the caret", async () => {
    getNote.mockResolvedValue("ab");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 1);
    const tab = keyDown(editor, "Tab");

    expect(tab.defaultPrevented).toBe(true);
    expect(readNoteText(editor)).toBe("a\tb");
  });

  it("Shift+Tab dedents selected lines, preserves the range, saves, and undoes as one chunk", async () => {
    getNote.mockResolvedValue("\tab\n\tcd");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaretRange(editor, 1, 7);
    const shiftTab = keyDown(editor, "Tab", { shiftKey: true });

    expect(shiftTab.defaultPrevented).toBe(true);
    expect(readNoteText(editor)).toBe("ab\ncd");
    expect(getCaretRange(editor)).toEqual({ start: 0, end: 5 });
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).toHaveBeenCalledWith("ab\ncd");

    keyDown(editor, "z", { ctrlKey: true });
    expect(readNoteText(editor)).toBe("\tab\n\tcd");
  });

  it("prevents a no-op Shift+Tab without saving", async () => {
    getNote.mockResolvedValue("ab");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 1);
    const shiftTab = keyDown(editor, "Tab", { shiftKey: true });

    expect(shiftTab.defaultPrevented).toBe(true);
    expect(readNoteText(editor)).toBe("ab");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).not.toHaveBeenCalled();
  });

  it("does not intercept composing Shift+Tab", async () => {
    getNote.mockResolvedValue("\tab");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    const shiftTab = composingKeyDown(editor, "Tab", { shiftKey: true });

    expect(shiftTab.defaultPrevented).toBe(false);
    expect(readNoteText(editor)).toBe("\tab");
  });

  it("replaces a non-collapsed selection with Space", async () => {
    getNote.mockResolvedValue("abcd");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    selectText(editor, 1, 3);
    keyDown(editor, " ");

    expect(readNoteText(editor)).toBe("a d");
  });

  it("does not intercept composing Space keydown events", async () => {
    getNote.mockResolvedValue("ab");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 1);
    const event = composingKeyDown(editor, " ");

    expect(event.defaultPrevented).toBe(false);
    expect(readNoteText(editor)).toBe("ab");
  });
});

describe("NotePane IME composition", () => {
  it("leaves preedit DOM untouched and saves only the committed Hangul", async () => {
    getNote.mockResolvedValue("base");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setEditorText(editor, "base!", 5);
    fireEvent.input(editor); // arm a pre-composition save to exercise flushNote's IME guard

    fireEvent.compositionStart(editor);
    const imeLine = updateComposition(editor, "base!ㅎ");
    expect(editor.firstElementChild).toBe(imeLine);
    expect(readNoteText(editor)).toBe("base!ㅎ");

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).not.toHaveBeenCalled();

    expect(updateComposition(editor, "base!한")).toBe(imeLine);
    expect(editor.firstElementChild).toBe(imeLine);
    fireEvent.compositionEnd(editor, { data: "한" });

    expect(readNoteText(editor)).toBe("base!한");
    expect(editor.firstElementChild).not.toBe(imeLine);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).toHaveBeenCalledTimes(1);
    expect(putNote).toHaveBeenCalledWith("base!한");
  });

  it("still repaints and saves ordinary input", async () => {
    getNote.mockResolvedValue("");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setEditorText(editor, "a", 1);
    const browserLine = editor.firstElementChild;
    fireEvent.input(editor);

    expect(readNoteText(editor)).toBe("a");
    expect(editor.firstElementChild).not.toBe(browserLine);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).toHaveBeenCalledWith("a");
  });
});

describe("NotePane note shortcuts", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("Ctrl+C copies the current line and leaves the note untouched", async () => {
    getNote.mockResolvedValue("one\ntwo\nthree");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 5);
    const event = keyDown(editor, "c", { ctrlKey: true });
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("two\n");
    expect(readNoteText(editor)).toBe("one\ntwo\nthree");
    expect(putNote).not.toHaveBeenCalled();
  });

  it("Ctrl+X cuts the current line and saves the shortened note", async () => {
    getNote.mockResolvedValue("one\ntwo\nthree");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setCaret(editor, 5);
    keyDown(editor, "x", { ctrlKey: true });

    expect(readNoteText(editor)).toBe("one\nthree");
    expect(container.querySelector("#note-status")!.textContent).toBe("Editing…");

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("two\n");
    expect(putNote).toHaveBeenCalledWith("one\nthree");
  });

  it("Ctrl+Z after a typed run restores the previous text and saves it", async () => {
    getNote.mockResolvedValue("base");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    setEditorText(editor, "basea", 5);
    fireEvent.input(editor);
    setEditorText(editor, "baseab", 6);
    fireEvent.input(editor);

    await act(async () => {
      await vi.runAllTimersAsync();
    });
    putNote.mockClear();
    keyDown(editor, "z", { ctrlKey: true });

    expect(readNoteText(editor)).toBe("base");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).toHaveBeenCalledWith("base");
  });

  it("Ctrl+Z with nothing to undo is a no-op", async () => {
    getNote.mockResolvedValue("base");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    keyDown(editor, "z", { ctrlKey: true });

    expect(readNoteText(editor)).toBe("base");
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(putNote).not.toHaveBeenCalled();
  });

  it("Ctrl+Z after a remote adopt does not resurrect the pre-adopt text", async () => {
    getNote.mockResolvedValue("base");
    const ref = createRef<NotePaneHandle>();
    const { container } = render(<NotePane ref={ref} />);
    await flushMicrotasks();

    getNote.mockResolvedValue("remote");
    await act(async () => {
      ref.current!.onNoteChange();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    keyDown(editor, "z", { ctrlKey: true });

    expect(readNoteText(editor)).toBe("remote");
  });

  it("does not intercept Ctrl+Shift+Z", async () => {
    getNote.mockResolvedValue("base");
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks();

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    const event = keyDown(editor, "z", { ctrlKey: true, shiftKey: true });

    expect(event.defaultPrevented).toBe(false);
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

describe("NotePane link reveal", () => {
  // Put the caret inside `line`'s first text node and announce it the way a real caret move would.
  function caretInto(line: Element) {
    const range = document.createRange();
    range.setStart(line.firstChild!, 0);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  it("reveals the raw Markdown only on the line that holds the caret", async () => {
    getNote.mockResolvedValue(["[a](https://a.io)", "[b](https://b.io)"].join("\n"));
    const { container } = render(<NotePane ref={createRef<NotePaneHandle>()} />);
    await flushMicrotasks(); // load the two link lines

    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    const [lineA, lineB] = Array.from(editor.children);

    // On load the editor is unfocused → every link collapsed (no line is being edited).
    expect(lineA.classList.contains("md-edit")).toBe(false);
    expect(lineB.classList.contains("md-edit")).toBe(false);

    // Focus and put the caret on the first link's line → only that line reveals.
    act(() => editor.focus());
    act(() => caretInto(lineA));
    expect(lineA.classList.contains("md-edit")).toBe(true);
    expect(lineB.classList.contains("md-edit")).toBe(false);

    // Move the caret to the second line → the reveal moves with it.
    act(() => caretInto(lineB));
    expect(lineA.classList.contains("md-edit")).toBe(false);
    expect(lineB.classList.contains("md-edit")).toBe(true);

    // Blur collapses everything again.
    act(() => editor.blur());
    expect(lineA.classList.contains("md-edit")).toBe(false);
    expect(lineB.classList.contains("md-edit")).toBe(false);
  });
});

describe("NotePane live recovery", () => {
  async function mount(base = "base") {
    getNote.mockResolvedValue(base);
    const ref = createRef<NotePaneHandle>();
    const rendered = render(<NotePane ref={ref} />);
    await flushMicrotasks();
    const editor = rendered.container.querySelector<HTMLDivElement>("#note-input")!;
    return { ...rendered, ref, editor };
  }

  async function changed(ref: React.RefObject<NotePaneHandle | null>) {
    await act(async () => { ref.current!.onNoteChange(); await settle(); });
  }

  it.each([false, true])("serializes saves across unchanged settings, Use theirs=%s", async (useTheirs) => {
    localStorage.setItem("ntr.serverUrl", "http://server-a");
    let stored = "base";
    const writes: { text: string; done: ReturnType<typeof deferred<void>> }[] = [];
    putNote.mockImplementation((text) => {
      const done = deferred<void>();
      writes.push({ text, done });
      return done.promise.then(() => { stored = text; });
    });
    const { ref, editor, getByText } = await mount();
    getNote.mockImplementation(async () => stored);
    setCaret(editor, 4);
    pasteInto(editor, "1");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(writes.map(({ text }) => text)).toEqual(["base1"]);
    const firstContext = noteWrites.mock.calls[0][1];

    activateTransport();
    await changed(ref);
    pasteInto(editor, "2");
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await changed(ref);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(writes).toHaveLength(1);
    expect(readNoteText(editor)).toBe("base12");

    const recoveryRead = deferred<string>();
    getNote.mockReturnValueOnce(recoveryRead.promise);
    await act(async () => { writes[0].done.resolve(); await settle(); });
    expect(stored).toBe("base1");
    expect(noteReads.mock.lastCall![0].generation).not.toBe(firstContext.generation);
    expect(noteReads.mock.lastCall![0].url).toBe(firstContext.url);
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(writes).toHaveLength(1);
    expect(readNoteText(editor)).toBe("base12");

    await act(async () => { recoveryRead.resolve(stored); await settle(); });
    expect(readNoteText(editor)).toBe("base12");
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    fireEvent.click(getByText(useTheirs ? "Use theirs" : "Keep mine"));
    await flushMicrotasks();
    if (useTheirs) {
      expect(writes).toHaveLength(1);
      expect(readNoteText(editor)).toBe("base1");
    } else {
      expect(writes.map(({ text }) => text)).toEqual(["base1", "base12"]);
      expect(noteWrites.mock.calls[1][1].generation).not.toBe(firstContext.generation);
      await act(async () => { writes[1].done.resolve(); await settle(); });
      await changed(ref);
      expect(stored).toBe("base12");
      expect(readNoteText(editor)).toBe("base12");
    }
  });

  it.each([false, true])("recovers after repeated activations and a failed GET, rejected PUT=%s", async (rejectSave) => {
    localStorage.setItem("ntr.serverUrl", "https://server-a");
    const { ref, editor, container, getByText } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    setCaret(editor, 4);
    pasteInto(editor, "1");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const reads = getNote.mock.calls.length;
    for (let i = 0; i < 3; i++) {
      localStorage.setItem("ntr.allowInvalidCert", i % 2 === 0 ? "1" : "0");
      activateTransport();
      await changed(ref);
    }
    pasteInto(editor, "2");
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(getNote).toHaveBeenCalledTimes(reads);
    expect(putNote).toHaveBeenCalledTimes(1);

    getNote.mockRejectedValueOnce(new Error("recovery unavailable")).mockResolvedValue(rejectSave ? "base" : "base1");
    await act(async () => {
      if (rejectSave) save.reject(new Error("obsolete PUT error"));
      else save.resolve();
      await settle();
    });
    expect(container.querySelector("#note-status")!.textContent).toContain("recovery unavailable");
    expect(container.querySelector("#note-status")!.textContent).not.toContain("obsolete PUT error");
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    expect(putNote).toHaveBeenCalledTimes(1);
    expect(readNoteText(editor)).toBe("base12");
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(noteReads.mock.lastCall![0].allowInvalidCert).toBe(true);
    if (!rejectSave) fireEvent.click(getByText("Keep mine"));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledTimes(2);
    expect(putNote).toHaveBeenLastCalledWith("base12");
    expect(noteWrites.mock.lastCall![1].allowInvalidCert).toBe(true);
  });

  it.each([false, true])("keeps A and B writes independently owned, return to A=%s", async (returnToA) => {
    localStorage.setItem("ntr.serverUrl", "http://server-a");
    const { ref, editor, container, getByText } = await mount();
    const saveA = deferred<void>();
    const saveB = deferred<void>();
    putNote.mockReturnValueOnce(saveA.promise).mockReturnValueOnce(saveB.promise);
    pasteInto(editor, " draft");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    getNote.mockResolvedValue("B");
    await changed(ref);
    fireEvent.click(getByText("Keep mine"));
    await flushMicrotasks();
    expect(noteWrites.mock.calls.map(([, owner]) => owner.url)).toEqual(["http://server-a", "http://server-b"]);
    expect(container.querySelector("#note-status")!.textContent).toBe("Saving…");

    if (returnToA) {
      localStorage.setItem("ntr.serverUrl", "http://server-a");
      activateTransport();
      getNote.mockResolvedValue("A");
      await changed(ref);
    }
    const reads = getNote.mock.calls.length;
    // Settle the inactive destination first; it cannot release the active slot.
    await act(async () => { (returnToA ? saveB : saveA).resolve(); await settle(); });
    expect(getNote).toHaveBeenCalledTimes(reads);
    if (!returnToA) expect(container.querySelector("#note-status")!.textContent).toBe("Saving…");
    pasteInto(editor, " later");
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(putNote).toHaveBeenCalledTimes(2);
    expect(readNoteText(editor)).toBe("base draft later");

    await act(async () => { (returnToA ? saveA : saveB).resolve(); await settle(); });
    if (returnToA) {
      expect(container.querySelector("#conflict-theirs")!.textContent).toBe("A");
      fireEvent.click(getByText("Keep mine"));
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledTimes(3);
    expect(putNote).toHaveBeenLastCalledWith("base draft later");
    expect(noteWrites.mock.lastCall![1].url).toBe(returnToA ? "http://server-a" : "http://server-b");
  });

  it("scopes outstanding local writes to their directory generation", async () => {
    const { ref, editor, container, getByText } = await mount();
    const first = deferred<void>();
    const second = deferred<void>();
    putNote.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    pasteInto(editor, " draft");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const firstOwner = noteWrites.mock.calls[0][1];
    activateTransport(true);
    getNote.mockResolvedValue("directory B");
    await changed(ref);
    expect(container.querySelector("#conflict-theirs")!.textContent).toBe("directory B");
    fireEvent.click(getByText("Keep mine"));
    await flushMicrotasks();
    const secondOwner = noteWrites.mock.calls[1][1];
    expect(secondOwner.url).toBe("");
    expect(secondOwner.localGeneration).not.toBe(firstOwner.localGeneration);
    await act(async () => { first.resolve(); await settle(); });
    expect(container.querySelector("#note-status")!.textContent).toBe("Saving…");
    pasteInto(editor, " later");
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(putNote).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(); await settle(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledTimes(3);
    expect(putNote).toHaveBeenLastCalledWith("base draft later");
  });

  it.each([false, true])("owns a pagehide-originated save until settlement, rejected=%s", async (rejectSave) => {
    const { ref, editor, getByText } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    pasteInto(editor, "1");
    window.dispatchEvent(new Event("pagehide"));
    window.dispatchEvent(new Event("pagehide"));
    pasteInto(editor, "2");
    activateTransport();
    await changed(ref);
    fireEvent.blur(editor);
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(putNote).toHaveBeenCalledTimes(1);
    getNote.mockResolvedValue(rejectSave ? "base" : "base1");
    await act(async () => {
      if (rejectSave) save.reject(new Error("pagehide PUT failed"));
      else save.resolve();
      await settle();
    });
    expect(readNoteText(editor)).toBe("base12");
    if (!rejectSave) fireEvent.click(getByText("Keep mine"));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledTimes(2);
    expect(putNote).toHaveBeenLastCalledWith("base12");
  });

  it("releases a late PUT after unmount without starting recovery or more writes", async () => {
    const { editor, unmount } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    pasteInto(editor, " draft");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    const reads = getNote.mock.calls.length;
    unmount();
    await act(async () => { save.resolve(); await settle(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getNote).toHaveBeenCalledTimes(reads);
    expect(putNote).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["longer remote", "x", ""])("adopts a clean focused note and clamps selection for %j", async (remote) => {
    const { ref, editor } = await mount("abcdef");
    act(() => editor.focus());
    await flushMicrotasks();
    act(() => setCaretRange(editor, 2, 5));
    getNote.mockResolvedValue(remote);
    await changed(ref);
    expect(readNoteText(editor)).toBe(remote);
    expect(document.activeElement).toBe(editor);
    expect(getCaretRange(editor)).toEqual({ start: Math.min(2, remote.length), end: Math.min(5, remote.length) });
    expect(putNote).not.toHaveBeenCalled();
  });

  it("does not move the caret on a no-op or steal focus from another control", async () => {
    const { ref, editor, container } = await mount();
    act(() => editor.focus());
    await flushMicrotasks();
    act(() => setCaret(editor, 2));
    await changed(ref);
    expect(getCaretRange(editor)).toEqual({ start: 2, end: 2 });
    const button = document.createElement("button");
    container.append(button);
    act(() => button.focus());
    getNote.mockResolvedValue("remote");
    await changed(ref);
    expect(document.activeElement).toBe(button);
    expect(readNoteText(editor)).toBe("remote");
  });

  it.each([true, false])("handles empty-note conflicts with Use theirs=%s", async (useTheirs) => {
    const { ref, editor, getByText } = await mount();
    pasteInto(editor, " draft");
    getNote.mockResolvedValue("");
    await changed(ref);
    expect(readNoteText(editor)).toBe("base draft");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    window.dispatchEvent(new Event("pagehide"));
    expect(putNote).not.toHaveBeenCalled();
    fireEvent.click(getByText(useTheirs ? "Use theirs" : "Keep mine"));
    await flushMicrotasks();
    if (useTheirs) {
      expect(readNoteText(editor)).toBe("");
      expect(putNote).not.toHaveBeenCalled();
    } else {
      expect(putNote).toHaveBeenCalledOnce();
      expect(putNote).toHaveBeenCalledWith("base draft");
    }
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(false);
  });

  it("blocks debounce, blur, and pagehide while an incoming read is unresolved", async () => {
    const { ref, editor } = await mount();
    pasteInto(editor, " draft");
    const read = deferred<string>();
    getNote.mockReturnValueOnce(read.promise);
    ref.current!.onNoteChange();
    fireEvent.blur(editor);
    window.dispatchEvent(new Event("pagehide"));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(putNote).not.toHaveBeenCalled();
    await act(async () => { read.resolve("remote"); await settle(); });
    expect(readNoteText(editor)).toBe("base draft");
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    expect(putNote).not.toHaveBeenCalled();
  });

  it.each([false, true])("drains events after a save, with extra typing=%s", async (extraTyping) => {
    const { ref, editor } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    pasteInto(editor, " mine");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledTimes(1);
    if (extraTyping) pasteInto(editor, " extra");
    getNote.mockResolvedValue("remote after save");
    await changed(ref);
    await act(async () => { save.resolve(); await settle(); });
    expect(readNoteText(editor)).toBe(extraTyping ? "base mine extra" : "remote after save");
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(extraTyping);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(putNote).toHaveBeenCalledTimes(1);
  });

  it("retries a failed incoming GET without another event and keeps the draft safe", async () => {
    const { ref, editor } = await mount();
    pasteInto(editor, " mine");
    getNote.mockRejectedValueOnce(new Error("temporary GET failure")).mockResolvedValue("remote");
    await changed(ref);
    expect(readNoteText(editor)).toBe("base mine");
    expect(putNote).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    expect(putNote).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("drains after a failed save without clearing its error or losing incoming work", async () => {
    const { ref, editor, container } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    pasteInto(editor, " mine");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    getNote.mockRejectedValueOnce(new Error("GET failed")).mockResolvedValue("remote");
    await changed(ref);
    await act(async () => { save.reject(new Error("PUT failed")); await settle(); });
    expect(container.querySelector("#note-status")!.textContent).toContain("PUT failed");
    expect(container.querySelector("#note-status")!.textContent).toContain("GET failed");
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(readNoteText(editor)).toBe("base mine");
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    expect(putNote).toHaveBeenCalledTimes(1);
  });

  it("classifies typing during a GET and drains a second event without stale autosave", async () => {
    const { ref, editor, container } = await mount();
    const first = deferred<string>();
    getNote.mockReturnValueOnce(first.promise).mockResolvedValue("latest remote");
    ref.current!.onNoteChange();
    pasteInto(editor, " typing");
    ref.current!.onNoteChange();
    await act(async () => { first.resolve("first remote"); await settle(); });
    expect(readNoteText(editor)).toBe("base typing");
    expect(container.querySelector("#conflict-theirs")!.textContent).toBe("latest remote");
    expect(putNote).not.toHaveBeenCalled();
  });

  it("defers remote repaint and dialog during IME, then conflicts on committed input", async () => {
    const { ref, editor } = await mount();
    fireEvent.compositionStart(editor);
    updateComposition(editor, "한");
    getNote.mockResolvedValue("remote");
    await changed(ref);
    expect(readNoteText(editor)).toBe("한");
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(false);
    fireEvent.compositionEnd(editor);
    await flushMicrotasks();
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    expect(putNote).not.toHaveBeenCalled();
  });

  it("preserves typing before initial load and invalidates StrictMode's old load", async () => {
    const old = deferred<string>();
    const latest = deferred<string>();
    getNote.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise);
    const { container } = render(<StrictMode><NotePane /></StrictMode>);
    const editor = container.querySelector<HTMLDivElement>("#note-input")!;
    pasteInto(editor, "draft before loading");
    await act(async () => { old.resolve("obsolete"); latest.resolve("current remote"); await settle(); });
    expect(readNoteText(editor)).toBe("draft before loading");
    expect(container.querySelector("#conflict-theirs")!.textContent).toBe("current remote");
    expect(putNote).not.toHaveBeenCalled();
  });

  it("retains a dirty draft on target change and rejects an old conflict choice", async () => {
    const { ref, editor, getByText, container } = await mount();
    pasteInto(editor, " mine");
    getNote.mockResolvedValue("remote A");
    await changed(ref);
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    getNote.mockResolvedValue("base"); // equal to the old baseline still requires a choice
    fireEvent.click(getByText("Keep mine"));
    await flushMicrotasks();
    expect(putNote).not.toHaveBeenCalled();
    expect(readNoteText(editor)).toBe("base mine");
    expect(container.querySelector("#conflict-theirs")!.textContent).toBe("base");
    fireEvent.click(getByText("Keep mine"));
    await flushMicrotasks();
    expect(putNote).toHaveBeenCalledTimes(1);
  });

  it("does not treat an unchanged settings target as a draft transfer", async () => {
    const { ref, editor } = await mount();
    pasteInto(editor, " mine");
    activateTransport();
    await changed(ref);
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(putNote).toHaveBeenCalledWith("base mine");
  });

  it("requires a choice when the local directory changes even with the same empty URL", async () => {
    const { ref, editor, getByText } = await mount();
    pasteInto(editor, " local draft");
    activateTransport(true);
    await changed(ref);
    expect(document.querySelector<HTMLDialogElement>("#note-conflict")!.open).toBe(true);
    expect(putNote).not.toHaveBeenCalled();
    fireEvent.click(getByText("Use theirs"));
    await flushMicrotasks();
    expect(readNoteText(editor)).toBe("base");
    expect(putNote).not.toHaveBeenCalled();
  });

  it("ignores late saves and reads after replacement or unmount", async () => {
    const { ref, editor, unmount } = await mount();
    const save = deferred<void>();
    putNote.mockReturnValueOnce(save.promise);
    pasteInto(editor, " mine");
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    getNote.mockResolvedValue("B");
    await changed(ref);
    await act(async () => { save.resolve(); await settle(); });
    expect(readNoteText(editor)).toBe("base mine");
    expect(putNote).toHaveBeenCalledTimes(1);
    const read = deferred<string>();
    getNote.mockReturnValueOnce(read.promise);
    ref.current!.onNoteChange();
    unmount();
    read.reject(new Error("late read"));
    await flushMicrotasks();
    const reads = getNote.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(getNote).toHaveBeenCalledTimes(reads);
    expect(putNote).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
