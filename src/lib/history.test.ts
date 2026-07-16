import { describe, expect, it } from "vitest";
import { NOTE_UNDO_COALESCE_MS, NOTE_UNDO_LIMIT } from "../config";
import { createHistory, record, reset, undo } from "./history";

describe("note history", () => {
  it("coalesces typing within the configured window", () => {
    const history = createHistory("");
    record(history, "a", 1, "type", 10);
    record(history, "ab", 2, "type", 10 + NOTE_UNDO_COALESCE_MS - 1);

    expect(undo(history)).toEqual({ text: "", caret: null });
    expect(undo(history)).toBeNull();
  });

  it("splits typing after a pause", () => {
    const history = createHistory("");
    record(history, "a", 1, "type", 10);
    record(history, "ab", 2, "type", 10 + NOTE_UNDO_COALESCE_MS);

    expect(undo(history)).toEqual({ text: "a", caret: 1 });
    expect(undo(history)).toEqual({ text: "", caret: null });
  });

  it("always splits chunk edits", () => {
    const history = createHistory("");
    record(history, "a", 1, "type", 10);
    record(history, "a\n", 2, "chunk", 20);
    record(history, "a\nb", 3, "chunk", 30);

    expect(undo(history)).toEqual({ text: "a\n", caret: 2 });
    expect(undo(history)).toEqual({ text: "a", caret: 1 });
  });

  it("returns null when undo is already at the base", () => {
    expect(undo(createHistory("base"))).toBeNull();
  });

  it("reset erases previous history", () => {
    const history = createHistory("old");
    record(history, "old edit", 8, "chunk", 10);
    reset(history, "new");

    expect(undo(history)).toBeNull();
  });

  it("drops the oldest entries at the configured limit", () => {
    const history = createHistory("0");
    for (let i = 1; i <= NOTE_UNDO_LIMIT + 2; i++) {
      record(history, String(i), i, "chunk", i);
    }

    let oldest = "";
    while (true) {
      const entry = undo(history);
      if (!entry) break;
      oldest = entry.text;
    }
    expect(oldest).toBe("3");
  });
});
