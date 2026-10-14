import { describe, expect, it } from "vitest";
import { classifyNoteEvent } from "./noteSync";

describe("classifyNoteEvent", () => {
  it("treats empty incoming text as a valid adoption or conflict", () => {
    expect(classifyNoteEvent("base", "base", "")).toBe("adopt");
    expect(classifyNoteEvent("base", "mine", "")).toBe("conflict");
    expect(classifyNoteEvent("base", "", "")).toBe("in-sync");
    expect(classifyNoteEvent("", "mine", "")).toBe("noop");
  });
  it("noop when the server has not changed from our base", () => {
    expect(classifyNoteEvent("base", "base", "base")).toBe("noop");
    expect(classifyNoteEvent("base", "local edits", "base")).toBe("noop");
  });

  it("adopt when the server changed and there are no unsaved edits", () => {
    expect(classifyNoteEvent("base", "base", "remote")).toBe("adopt");
  });

  it("in-sync when the editor already holds the remote text", () => {
    expect(classifyNoteEvent("base", "remote", "remote")).toBe("in-sync");
  });

  it("conflict when unsaved edits differ from a changed server", () => {
    expect(classifyNoteEvent("base", "mine", "theirs")).toBe("conflict");
  });
});
