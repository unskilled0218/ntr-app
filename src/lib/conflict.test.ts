import { describe, expect, it } from "vitest";
import { classifyConflict } from "./conflict";

describe("classifyConflict", () => {
  it("is in-sync when both copies are identical", () => {
    expect(classifyConflict("a", "a")).toBe("in-sync");
  });

  it("is in-sync when both copies are empty (equality is checked first)", () => {
    expect(classifyConflict("", "")).toBe("in-sync");
  });

  it("adopts the server when they differ but the local copy is empty", () => {
    expect(classifyConflict("", "server text")).toBe("adopt-server");
  });

  it("is a conflict when they differ and the local copy is non-empty", () => {
    expect(classifyConflict("local text", "server text")).toBe("conflict");
  });
});
