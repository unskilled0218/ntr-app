import { describe, expect, it } from "vitest";
import { composeText, parseLabelInput } from "./labels";

describe("composeText", () => {
  it("puts the priority first and appends label sigils and due tag", () => {
    expect(
      composeText({ priority: "A", description: "call bank", project: "money", context: "phone", due: "2026-06-30" }),
    ).toBe("(A) call bank +money @phone due:2026-06-30");
  });

  it("omits empty fields and trims the description", () => {
    expect(composeText({ priority: "", description: "  buy milk  ", project: "", context: "", due: "" })).toBe(
      "buy milk",
    );
  });

  it("emits project before context", () => {
    expect(composeText({ priority: "", description: "x", project: "p", context: "c", due: "" })).toBe("x +p @c");
  });
});

describe("parseLabelInput", () => {
  it("strips leading sigils and accepts a bare name", () => {
    expect(parseLabelInput("+work")).toEqual({ name: "work" });
    expect(parseLabelInput("@@home")).toEqual({ name: "home" });
  });

  it("rejects empty, whitespace, and sigil/colon-bearing names", () => {
    expect(parseLabelInput("   ")).toHaveProperty("error");
    expect(parseLabelInput("two words")).toHaveProperty("error");
    expect(parseLabelInput("a:b")).toHaveProperty("error");
    expect(parseLabelInput("a+b")).toHaveProperty("error");
  });
});
