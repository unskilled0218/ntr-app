import { describe, expect, it } from "vitest";
import { cmpMissingLast, SORTS, sortTasks } from "./config";
import type { Task } from "./api";

function task(over: Partial<Task>): Task {
  return {
    id: 0,
    completed: false,
    completion_date: null,
    creation_date: null,
    description: "",
    lists: [],
    contexts: [],
    tags: {},
    raw: "",
    ...over,
  };
}

describe("cmpMissingLast", () => {
  it("orders present values ascending and sinks absent ones to the bottom", () => {
    expect(cmpMissingLast("A", "B")).toBeLessThan(0);
    expect(cmpMissingLast("B", "A")).toBeGreaterThan(0);
    expect(cmpMissingLast(null, "A")).toBe(1); // missing after present
    expect(cmpMissingLast("A", null)).toBe(-1);
    expect(cmpMissingLast(null, null)).toBe(0);
  });
});

describe("sortTasks", () => {
  it("file order is a no-op returning the same array reference", () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })];
    expect(sortTasks(tasks, "file")).toBe(tasks);
  });

  it("removed priority sort falls back to file order", () => {
    const a = task({ id: 1 });
    const b = task({ id: 2 });
    const c = task({ id: 3 });
    const d = task({ id: 4 });
    const out = sortTasks([a, b, c, d], "priority").map((t) => t.id);
    expect(out).toEqual([1, 2, 3, 4]);
  });

  it("due sort reads the due tag and sinks tasks without one", () => {
    const a = task({ id: 1, tags: { due: "2026-07-01" } });
    const b = task({ id: 2, tags: {} });
    const c = task({ id: 3, tags: { due: "2026-06-01" } });
    expect(sortTasks([a, b, c], "due").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("lists sort keys off the alphabetically-first list, missing-list tasks last", () => {
    const a = task({ id: 1, lists: ["work"] });
    const b = task({ id: 2, lists: [] });
    const c = task({ id: 3, lists: ["zeta", "alpha"] }); // keys off "alpha"
    expect(sortTasks([a, b, c], "lists").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("created sort orders dates with missing dates last", () => {
    const tasks = [task({ id: 1, creation_date: "2026-07-01" }), task({ id: 2 }), task({ id: 3, creation_date: "2026-06-01" })];
    expect(sortTasks(tasks, "created").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("desc reverses a comparator sort, putting missing-key tasks first", () => {
    const a = task({ id: 1, creation_date: "2026-06-02" });
    const b = task({ id: 2 });
    const c = task({ id: 3, creation_date: "2026-06-01" });
    // asc is [A, B, missing] = [3, 1, 2]; desc negates the comparator => [2, 1, 3].
    expect(sortTasks([a, b, c], "created", "desc").map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("desc on file order returns the backend order reversed", () => {
    const tasks = [task({ id: 1 }), task({ id: 2 }), task({ id: 3 })];
    expect(sortTasks(tasks, "file", "desc").map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("omitting the direction defaults to ascending", () => {
    const a = task({ id: 1 });
    const c = task({ id: 3 });
    expect(sortTasks([a, c], "priority")).toEqual(sortTasks([a, c], "priority", "asc"));
  });

  it("never mutates the input array (asc comparator, desc comparator, file desc)", () => {
    const tasks = [task({ id: 1 }), task({ id: 2 })];
    const before = tasks.map((t) => t.id);
    sortTasks(tasks, "priority");
    sortTasks(tasks, "priority", "desc");
    sortTasks(tasks, "file", "desc");
    expect(tasks.map((t) => t.id)).toEqual(before);
  });

  it("offers exactly the file/due/created/lists sorts", () => {
    expect(Object.keys(SORTS)).toEqual(["file", "due", "created", "lists"]);
  });
});
