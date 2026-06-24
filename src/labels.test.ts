import { describe, expect, it } from "vitest";
import { bareDescription, composeText, parseLabelInput, planLabelRemoval, removeLabel } from "./labels";

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

describe("removeLabel", () => {
  it("strips the project token and collapses the gap, leaving other tokens", () => {
    expect(removeLabel("(A) call bank +work @phone due:2026-06-30", "project", "work")).toBe(
      "(A) call bank @phone due:2026-06-30",
    );
  });

  it("uses the @ prefix for contexts", () => {
    expect(removeLabel("buy milk +groceries @store", "context", "store")).toBe("buy milk +groceries");
  });

  it("matches whole tokens only: +work leaves +workshop and the word homework untouched", () => {
    expect(removeLabel("finish homework +workshop +work", "project", "work")).toBe(
      "finish homework +workshop",
    );
  });

  it("preserves a completion prefix and dates", () => {
    expect(removeLabel("x 2026-06-02 2026-06-01 tidy +home", "project", "home")).toBe(
      "x 2026-06-02 2026-06-01 tidy",
    );
  });

  it("returns the line trimmed and unchanged when the name is absent", () => {
    expect(removeLabel("  plain task +other  ", "project", "missing")).toBe("plain task +other");
  });
});

describe("planLabelRemoval", () => {
  const tasks = [
    { id: 1, projects: ["work"], contexts: ["phone"], raw: "call bank +work @phone" },
    { id: 2, projects: ["home"], contexts: [], raw: "tidy +home" },
    { id: 3, projects: ["work", "errand"], contexts: [], raw: "post +work +errand" },
  ];

  it("returns an id + stripped line for each task carrying the project, skipping the rest", () => {
    expect(planLabelRemoval(tasks, "project", "work")).toEqual([
      { id: 1, text: "call bank @phone" },
      { id: 3, text: "post +errand" },
    ]);
  });

  it("filters on parsed contexts, not a raw substring", () => {
    expect(planLabelRemoval(tasks, "context", "phone")).toEqual([{ id: 1, text: "call bank +work" }]);
  });

  it("returns an empty plan when no task carries the name", () => {
    expect(planLabelRemoval(tasks, "project", "ghost")).toEqual([]);
  });
});
