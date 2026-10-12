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
    projects: [],
    tags: {} as Record<string, string>,
  };
  const fields = { priority: "B", description: "call later", project: "work", due: "2026-06-30" };

  it("keeps active creation date and every hidden context while changing visible fields", () => {
    expect(composeEditedTask(original, fields, "2026-10-11")).toBe("(B) 2026-06-01 call later +work @phone @store due:2026-06-30 updated:2026-10-11");
  });

  it.each([{ contexts: [] }, { contexts: ["phone"] }, { contexts: ["phone", "store"] }])("retains context values $contexts", ({ contexts }) => {
    expect(composeEditedTask({ ...original, contexts }, { ...fields, priority: "", project: "", due: "" }, "2026-10-11")).toBe(["2026-06-01 call later", ...contexts.map((c) => `@${c}`), "updated:2026-10-11"].join(" "));
  });

  it.each(["A", "B", "Z", ""])("serializes completed effective priority '%s' without stale tags", (priority) => {
    const completed = { ...original, completed: true, priority: null, completion_date: "2026-06-02", description: "call bank @phone @store pri:A" };
    const text = composeEditedTask(completed, { ...fields, priority, description: "call later pri:A pri:B" }, "2026-10-11");
    expect(text).toBe(`x 2026-06-02 2026-06-01 call later +work @phone @store due:2026-06-30${priority ? ` pri:${priority}` : ""} updated:2026-10-11`);
  });

  it("rejects inconsistent completed dates instead of losing creation", () => {
    expect(() => composeEditedTask({ ...original, completed: true }, { ...fields, priority: "" }, "2026-10-11")).toThrow("without a completion date");
  });

  it("supports context-only edits without inventing a description", () => {
    expect(composeEditedTask({ ...original, creation_date: null }, { priority: "", description: "", project: "", due: "" }, "2026-10-11")).toBe("@phone @store updated:2026-10-11");
  });

  it("replaces old stamps while preserving original dates, multiple projects, and hidden tags", () => {
    const source = { ...original, projects: ["work", "cart"], tags: { updated: "2026-10-10", custom: "old", url: "https://old:443/path" } };
    const snapshot = structuredClone(source);
    const first = composeEditedTask(source, { ...fields, description: "call later custom:new updated:2026-10-09 updated:bad due:old +work @phone @phone" }, "2026-10-11");
    expect(first).toBe("(B) 2026-06-01 call later custom:new +work @phone +cart @store due:2026-06-30 url:https://old:443/path updated:2026-10-11");
    expect(first).not.toContain("custom:old");
    const second = composeEditedTask({ ...source, tags: { ...source.tags, custom: "new", updated: "2026-10-11" } }, { ...fields, description: "call again" }, "2026-10-12");
    expect(second).toContain("2026-06-01 call again +work +cart");
    expect(second).toContain("custom:new");
    expect(second.match(/updated:/g)).toHaveLength(1);
    expect(second).toContain("updated:2026-10-12");
    expect(source).toEqual(snapshot);
  });

  it("preserves unmentioned keys and honors submitted exact keys and colon-containing values", () => {
    const source = { ...original, tags: { custom: "old", url: "https://old/path" } };
    const text = composeEditedTask(source, { ...fields, description: "call customized:new url:https://new:443/path" }, "2026-10-11");
    expect(text).toContain("customized:new url:https://new:443/path");
    expect(text).toContain("custom:old");
    expect(text).not.toContain("url:https://old/path");
    const same = composeEditedTask(source, { ...fields, description: "call custom:old custom:new" }, "2026-10-11");
    expect(same.match(/custom:old/g)).toHaveLength(1);
    expect(same.indexOf("custom:old")).toBeLessThan(same.indexOf("custom:new"));
  });

  it.each(["home", ""])("applies explicit single-project selection '%s'", (project) => {
    const text = composeEditedTask({ ...original, projects: ["work", "cart"] }, { ...fields, project }, "2026-10-11");
    expect(text).not.toContain("+work");
    expect(text).not.toContain("+cart");
    expect(text.includes("+home")).toBe(project === "home");
  });

  it("edits no-date legacy records without inventing history and rejects an updated-only body", () => {
    const source = { ...original, completed: true, creation_date: null, contexts: [] };
    expect(composeEditedTask(source, { ...fields, priority: "" }, "2026-10-11")).toBe("x call later +work due:2026-06-30 updated:2026-10-11");
    expect(composeEditedTask(source, { ...fields, description: "updated:old" }, "2026-10-11")).toBe("");
    expect(() => composeEditedTask(original, fields, "2026-02-30")).toThrow("Invalid task edit date");
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

  it("retains creation and update metadata during bulk project removal", () => {
    const raw = "2026-10-10 call +work due:2026-10-12 updated:2026-10-11 custom:new";
    expect(planLabelRemoval([{ id: 1, projects: ["work"], contexts: [], raw }], "project", "work")).toEqual([
      { id: 1, text: "2026-10-10 call due:2026-10-12 updated:2026-10-11 custom:new" },
    ]);
  });
});
