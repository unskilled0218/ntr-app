import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createRef } from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import NotePane, { type NotePaneHandle } from "./NotePane";
import { getCaretRange, readNoteText, setCaret, setCaretRange, setEditorText } from "../lib/caret";

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
