import { describe, expect, it } from "vitest";
import { cutRange, lineBounds } from "./noteEdit";

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
