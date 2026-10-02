import { describe, expect, it } from "vitest";
import { cutRange, dedentRange, lineBounds } from "./noteEdit";

describe("lineBounds", () => {
  it("finds first, middle, and last lines", () => {
    const text = "one\ntwo\nthree";
    expect(lineBounds(text, 1)).toEqual({ start: 0, end: 3 });
    expect(lineBounds(text, 5)).toEqual({ start: 4, end: 7 });
    expect(lineBounds(text, text.length)).toEqual({ start: 8, end: 13 });
  });

  it("handles empty lines and a caret at the line end", () => {
    expect(lineBounds("one\n\nthree", 4)).toEqual({ start: 4, end: 4 });
    expect(lineBounds("one\ntwo", 3)).toEqual({ start: 0, end: 3 });
  });
});

describe("cutRange", () => {
  it("cuts the current middle line with its trailing newline", () => {
    expect(cutRange("one\ntwo\nthree", 5, 5)).toEqual({
      text: "one\nthree",
      caret: 4,
      copied: "two\n",
    });
  });

  it("cuts the last line with its preceding newline", () => {
    expect(cutRange("one\ntwo\nthree", 10, 10)).toEqual({
      text: "one\ntwo",
      caret: 7,
      copied: "three\n",
    });
  });

  it("cuts the only line to an empty note", () => {
    expect(cutRange("one", 1, 1)).toEqual({ text: "", caret: 0, copied: "one\n" });
  });

  it("cuts exactly a real selection", () => {
    expect(cutRange("one\ntwo\nthree", 1, 6)).toEqual({
      text: "oo\nthree",
      caret: 1,
      copied: "ne\ntw",
    });
  });

  it("copies an empty current line with a newline payload", () => {
    expect(cutRange("one\n\nthree", 4, 4).copied).toBe("\n");
  });
});

describe("dedentRange", () => {
  it("removes one leading tab from the caret line and adjusts the caret", () => {
    expect(dedentRange("one\n\ttwo\nthree", 7, 7)).toEqual({
      text: "one\ntwo\nthree",
      start: 6,
      end: 6,
      changed: true,
    });
  });

  it("dedents every selected line and preserves the logical selection", () => {
    expect(dedentRange("\tone\n\ttwo\n\tthree", 1, 16)).toEqual({
      text: "one\ntwo\nthree",
      start: 0,
      end: 13,
      changed: true,
    });
  });

  it("does not include a line when the selection ends at its start", () => {
    expect(dedentRange("\tone\n\ttwo", 0, 5)).toEqual({
      text: "one\n\ttwo",
      start: 0,
      end: 4,
      changed: true,
    });
  });

  it("normalizes reversed and out-of-range endpoints", () => {
    expect(dedentRange("\tone", 99, -3)).toEqual({ text: "one", start: 0, end: 3, changed: true });
  });

  it("leaves spaces and unindented lines unchanged", () => {
    expect(dedentRange("  one\ntwo", 0, 10)).toEqual({
      text: "  one\ntwo",
      start: 0,
      end: 9,
      changed: false,
    });
  });

  it("uses UTF-16 offsets when tabs follow non-BMP characters", () => {
    expect(dedentRange("😀\n\ttwo", 5, 5)).toEqual({ text: "😀\ntwo", start: 4, end: 4, changed: true });
  });
});
