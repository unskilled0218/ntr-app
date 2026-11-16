import { describe, expect, it } from "vitest";
import { bareDescription, composeEditedTask, composeText, hideContexts, parseLabelInput, planLabelRemoval, removeLabel, unionLabels } from "./labels";

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
  it("appends label sigils and due tag", () => {
    expect(
      composeText({ description: "call bank", list: "money", contexts: ["phone"], due: "2026-06-30" }),
    ).toBe("call bank +money @phone due:2026-06-30");
  });

  it("omits empty fields and trims the description", () => {
    expect(composeText({ description: "  buy milk  ", list: "", contexts: [], due: "" })).toBe(
      "buy milk",
    );
  });

  it("emits list before context", () => {
    expect(composeText({ description: "x", list: "p", contexts: ["c"], due: "" })).toBe("x +p @c");
  });

  it("does not duplicate preserved contexts already typed in the description", () => {
    expect(composeText({ description: "call @phone", list: "", contexts: ["phone", "store", "store"], due: "" })).toBe("call @phone @store");
  });
});

describe("composeEditedTask", () => {
  const original = {
    completed: false,
    raw: "(A) 2026-06-01 call bank @phone @store",
    creation_date: "2026-06-01",
    completion_date: null,
    description: "call bank @phone @store",
    contexts: ["phone", "store"],
    lists: [],
    tags: {} as Record<string, string>,
  };
  const fields = { description: "call later", list: "work", due: "2026-06-30" };

  it("keeps active creation date and every hidden context while changing visible fields", () => {
    expect(composeEditedTask(original, fields, "2026-10-11")).toBe("(A) 2026-06-01 call later +work @phone @store due:2026-06-30 updated:2026-10-11");
  });

  it.each([{ contexts: [] }, { contexts: ["phone"] }, { contexts: ["phone", "store"] }])("retains context values $contexts", ({ contexts }) => {
    expect(composeEditedTask({ ...original, contexts }, { ...fields, list: "", due: "" }, "2026-10-11")).toBe(["(A) 2026-06-01 call later", ...contexts.map((c) => `@${c}`), "updated:2026-10-11"].join(" "));
  });

  it.each(["pri:A", "pri:A pri:B", "pri:B pri:A", "pri:A pri:A", ""])("serializes submitted ordinary tokens '%s' exactly", (tokens) => {
    const completed = { ...original, completed: true, completion_date: "2026-06-02", description: "call bank @phone @store pri:A", raw: "x (A) 2026-06-02 2026-06-01 call bank @phone @store pri:A", tags: { pri: "A" } };
    const text = composeEditedTask(completed, { ...fields, description: `call later${tokens ? ` ${tokens}` : ""}` }, "2026-10-11");
    expect(text).toBe(`x (A) 2026-06-02 2026-06-01 call later${tokens ? ` ${tokens}` : ""} +work @phone @store due:2026-06-30 updated:2026-10-11`);
  });

  it("rejects inconsistent completed dates instead of losing creation", () => {
    expect(() => composeEditedTask({ ...original, completed: true }, fields, "2026-10-11")).toThrow("without a completion date");
  });

  it("supports context-only edits without inventing a description", () => {
    expect(composeEditedTask({ ...original, creation_date: null, raw: original.description }, { description: "", list: "", due: "" }, "2026-10-11")).toBe("@phone @store updated:2026-10-11");
  });

  it("replaces old stamps while preserving original dates, multiple lists, and hidden tags", () => {
    const source = { ...original, lists: ["work", "cart"], tags: { updated: "2026-10-10", custom: "old", url: "https://old:443/path" } };
    const snapshot = structuredClone(source);
    const first = composeEditedTask(source, { ...fields, description: "call later custom:new updated:2026-10-09 updated:bad due:old +work @phone @phone" }, "2026-10-11");
    expect(first).toBe("(A) 2026-06-01 call later custom:new +work @phone +cart @store due:2026-06-30 url:https://old:443/path updated:2026-10-11");
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

  it.each(["home", ""])("applies explicit single-list selection '%s'", (list) => {
    const text = composeEditedTask({ ...original, lists: ["work", "cart"] }, { ...fields, list }, "2026-10-11");
    expect(text).not.toContain("+work");
    expect(text).not.toContain("+cart");
    expect(text.includes("+home")).toBe(list === "home");
  });

  it("edits no-date legacy records without inventing history and rejects an updated-only body", () => {
    const source = { ...original, completed: true, creation_date: null, contexts: [], raw: `x ${original.description}` };
    expect(composeEditedTask(source, fields, "2026-10-11")).toBe("x call later +work due:2026-06-30 updated:2026-10-11");
    expect(composeEditedTask(source, { ...fields, description: "updated:old" }, "2026-10-11")).toBe("");
    expect(() => composeEditedTask(original, fields, "2026-02-30")).toThrow("Invalid task edit date");
  });

  it.each([false, true])("validates raw lifecycle data for old and new DTO shapes (completed=%s)", (completed) => {
    const source = { ...original, completed, completion_date: completed ? "2026-06-02" : null,
      raw: `${completed ? "x " : ""}(A) ${completed ? "2026-06-02 " : ""}2026-06-01 ${original.description}` };
    for (const dto of [source, { ...source, priority: "Z" }]) {
      expect(composeEditedTask(dto, fields, "2026-10-11")).toContain("(A)");
      for (const changes of [
        { raw: undefined }, { raw: "" }, { raw: `${dto.raw}\nother` },
        { completed: !completed }, { creation_date: "2026-06-03" },
        { completion_date: "2026-06-03" }, { description: "inconsistent body" },
        { raw: dto.raw.replace("(A) ", "(A)") },
      ]) {
        const invalid = { ...dto, ...changes } as typeof source;
        expect(() => composeEditedTask(invalid, fields, "2026-10-11")).toThrow(/Cannot safely edit|without a completion date/);
      }
    }
  });

  it.each(["(A)", "(A) call", " (Z) call", "(A)\tcall"])("rejects ambiguous submitted description %s", (description) => {
    expect(() => composeText({ description, list: "", contexts: [], due: "" })).toThrow("reserved for legacy data");
    expect(() => composeEditedTask(original, { ...fields, description }, "2026-10-11")).toThrow("reserved for legacy data");
  });

  it.each(["(A)call", "(a) call", "(AA) call", "call (A)"])("keeps ordinary submitted description %s", (description) => {
    expect(composeText({ description, list: "", contexts: [], due: "" })).toBe(description);
    expect(composeEditedTask(original, { ...fields, description }, "2026-10-11")).toContain(`2026-06-01 ${description}`);
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
  it("strips list, context, and tag tokens leaving the human text", () => {
    expect(bareDescription("buy milk +groceries @store due:2026-06-30", ["groceries"], ["store"], { due: "2026-06-30" })).toBe("buy milk");
  });

  it("strips all lists when there are multiple", () => {
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
  it("strips the list token and collapses the gap, leaving other tokens", () => {
    expect(removeLabel("(A) call bank +work @phone due:2026-06-30", "list", "work")).toBe(
      "(A) call bank @phone due:2026-06-30",
    );
  });

  it("uses the @ prefix for contexts", () => {
    expect(removeLabel("buy milk +groceries @store", "context", "store")).toBe("buy milk +groceries");
  });

  it("matches whole tokens only: +work leaves +workshop and the word homework untouched", () => {
    expect(removeLabel("finish homework +workshop +work", "list", "work")).toBe(
      "finish homework +workshop",
    );
  });

  it("preserves a completion prefix and dates", () => {
    expect(removeLabel("x 2026-06-02 2026-06-01 tidy +home", "list", "home")).toBe(
      "x 2026-06-02 2026-06-01 tidy",
    );
  });

  it("returns the line trimmed and unchanged when the name is absent", () => {
    expect(removeLabel("  plain task +other  ", "list", "missing")).toBe("plain task +other");
  });
});

describe("planLabelRemoval", () => {
  const tasks = [
    { id: 1, lists: ["work"], contexts: ["phone"], raw: "call bank +work @phone" },
    { id: 2, lists: ["home"], contexts: [], raw: "tidy +home" },
    { id: 3, lists: ["work", "errand"], contexts: [], raw: "post +work +errand" },
  ];

  it("returns an id + stripped line for each task carrying the list, skipping the rest", () => {
    expect(planLabelRemoval(tasks, "list", "work")).toEqual([
      { id: 1, text: "call bank @phone" },
      { id: 3, text: "post +errand" },
    ]);
  });

  it("filters on parsed contexts, not a raw substring", () => {
    expect(planLabelRemoval(tasks, "context", "phone")).toEqual([{ id: 1, text: "call bank +work" }]);
  });

  it("returns an empty plan when no task carries the name", () => {
    expect(planLabelRemoval(tasks, "list", "ghost")).toEqual([]);
  });

  it("retains creation and update metadata during bulk list removal", () => {
    const raw = "2026-10-10 call +work due:2026-10-12 updated:2026-10-11 custom:new";
    expect(planLabelRemoval([{ id: 1, lists: ["work"], contexts: [], raw }], "list", "work")).toEqual([
      { id: 1, text: "2026-10-10 call due:2026-10-12 updated:2026-10-11 custom:new" },
    ]);
  });
});
