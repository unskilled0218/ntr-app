import { describe, expect, it } from "vitest";
import { bareDescription, composeText, parseLabelInput } from "./labels";

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

describe("bareDescription", () => {
  it("strips project, context, and tag tokens leaving the human text", () => {
    expect(bareDescription("buy milk +groceries @store due:2026-06-30", ["groceries"], ["store"], { due: "2026-06-30" })).toBe("buy milk");
  });

  it("strips all projects when there are multiple", () => {
    expect(bareDescription("call bank +money +work", ["money", "work"], [], {})).toBe("call bank");
  });

  it("returns description unchanged when there are no structured fields", () => {
    expect(bareDescription("plain task", [], [], {})).toBe("plain task");
  });

  it("returns empty string when description is only label tokens", () => {
    expect(bareDescription("+groceries @store", ["groceries"], ["store"], {})).toBe("");
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
