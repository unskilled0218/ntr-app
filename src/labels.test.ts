import { describe, expect, it } from "vitest";
import { bareDescription, composeEditedTask, composeText, getTaskPriority, hideContexts, parseLabelInput, planLabelRemoval, removeLabel, unionLabels } from "./labels";

describe("unionLabels", () => {
  it("merges and de-duplicates remembered and derived labels", () => {
    expect(unionLabels(["work", "home"], ["work", "errand"])).toEqual(["work", "home", "errand"]);
  });

  it("keeps a remembered-only label", () => {
    expect(unionLabels(["orphan"], [])).toEqual(["orphan"]);
  });

  it("returns an empty list for two empty inputs", () => {
    expect(unionLabels([], [])).toEqual([]);
  });
});

describe("composeText", () => {
  it("puts the priority first and appends label sigils and due tag", () => {
    expect(
      composeText({ priority: "A", description: "call bank", project: "money", contexts: ["phone"], due: "2026-06-30" }),
    ).toBe("(A) call bank +money @phone due:2026-06-30");
  });

  it("omits empty fields and trims the description", () => {
    expect(composeText({ priority: "", description: "  buy milk  ", project: "", contexts: [], due: "" })).toBe(
      "buy milk",
    );
  });

  it("emits project before context", () => {
    expect(composeText({ priority: "", description: "x", project: "p", contexts: ["c"], due: "" })).toBe("x +p @c");
  });

  it("does not duplicate preserved contexts already typed in the description", () => {
    expect(composeText({ priority: "", description: "call @phone", project: "", contexts: ["phone", "store", "store"], due: "" })).toBe("call @phone @store");
  });
});

describe("composeEditedTask", () => {
  const original = {
    completed: false,
    priority: "A",
    creation_date: "2026-06-01",
    completion_date: null,
    description: "call bank @phone @store",
    contexts: ["phone", "store"],
  };
  const fields = { priority: "B", description: "call later", project: "work", due: "2026-06-30" };

  it("keeps active creation date and every hidden context while changing visible fields", () => {
    expect(composeEditedTask(original, fields)).toBe("(B) 2026-06-01 call later +work @phone @store due:2026-06-30");
  });

  it.each([{ contexts: [] }, { contexts: ["phone"] }, { contexts: ["phone", "store"] }])("retains context values $contexts", ({ contexts }) => {
    expect(composeEditedTask({ ...original, contexts }, { ...fields, priority: "", project: "", due: "" })).toBe(["2026-06-01 call later", ...contexts.map((c) => `@${c}`)].join(" "));
  });

  it.each(["A", "B", "Z", ""])("serializes completed effective priority '%s' without stale tags", (priority) => {
    const completed = { ...original, completed: true, priority: null, completion_date: "2026-06-02", description: "call bank @phone @store pri:A" };
    const text = composeEditedTask(completed, { ...fields, priority, description: "call later pri:A pri:B" });
    expect(text).toBe(`x 2026-06-02 2026-06-01 call later +work @phone @store due:2026-06-30${priority ? ` pri:${priority}` : ""}`);
  });

  it("does not emit a creation date as a completion date", () => {
    expect(composeEditedTask({ ...original, completed: true }, { ...fields, priority: "" })).toBe("x call later +work @phone @store due:2026-06-30");
  });

  it("supports context-only edits without inventing a description", () => {
    expect(composeEditedTask({ ...original, creation_date: null }, { priority: "", description: "", project: "", due: "" })).toBe("@phone @store");
  });
});

describe("getTaskPriority", () => {
  it.each(["A", "Z"])("restores completed priority %s from its saved tag", (priority) => {
    expect(getTaskPriority({ completed: true, priority: null, description: `task pri:${priority}` })).toBe(priority);
  });

  it("prefers a leading priority and ignores invalid or active saved tags", () => {
    expect(getTaskPriority({ completed: true, priority: "B", description: "task pri:A" })).toBe("B");
    expect(getTaskPriority({ completed: true, priority: null, description: "task pri:AA pri:a" })).toBe("");
    expect(getTaskPriority({ completed: false, priority: null, description: "task pri:A" })).toBe("");
  });
});

describe("hideContexts", () => {
  it("removes all exact context tokens, including repeated tokens", () => {
    expect(hideContexts("call @phone @store @phone", ["phone", "store"])).toBe("call");
  });

  it("leaves prefix collisions, email, and URL text intact", () => {
    expect(hideContexts("@phonebook mail@phone https://example.com/@phone @phone", ["phone"])).toBe("@phonebook mail@phone https://example.com/@phone");
  });
});

describe("bareDescription", () => {
  it("strips project, context, and tag tokens leaving the human text", () => {
    expect(bareDescription("buy milk +groceries @store due:2026-06-30", ["groceries"], ["store"], { due: "2026-06-30" })).toBe("buy milk");
  });

  it("strips all projects when there are multiple", () => {
    expect(bareDescription("call bank +money +work", ["money", "work"], [], {})).toBe("call bank");
  });

  it("does not corrupt embedded metadata-like text", () => {
    expect(bareDescription("mail@phone https://site/@phone @phone +workshop +work", ["work"], ["phone"], {})).toBe("mail@phone https://site/@phone +workshop");
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
