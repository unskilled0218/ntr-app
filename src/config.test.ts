import { describe, expect, it } from "vitest";
import { cmpMissingLast, SORTS, sortTasks } from "./config";
import type { Task } from "./api";

function task(over: Partial<Task>): Task {
  return {
    id: 0,
    completed: false,
    priority: null,
    completion_date: null,
    creation_date: null,
    description: "",
    projects: [],
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

  it("priority sort is ascending with missing priorities last, file order breaking ties", () => {
    const a = task({ id: 1, priority: "B" });
    const b = task({ id: 2, priority: null });
    const c = task({ id: 3, priority: "A" });
    const d = task({ id: 4, priority: "A" });
    const out = sortTasks([a, b, c, d], "priority").map((t) => t.id);
    expect(out).toEqual([3, 4, 1, 2]); // A(3),A(4) by file order, then B(1), then missing(2)
  });

  it("due sort reads the due tag and sinks tasks without one", () => {
    const a = task({ id: 1, tags: { due: "2026-07-01" } });
    const b = task({ id: 2, tags: {} });
    const c = task({ id: 3, tags: { due: "2026-06-01" } });
    expect(sortTasks([a, b, c], "due").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("projects sort keys off the alphabetically-first project, missing-project tasks last", () => {
    const a = task({ id: 1, projects: ["work"] });
    const b = task({ id: 2, projects: [] });
    const c = task({ id: 3, projects: ["zeta", "alpha"] }); // keys off "alpha"
    expect(sortTasks([a, b, c], "projects").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("contexts sort keys off the alphabetically-first context, missing-context tasks last", () => {
    const a = task({ id: 1, contexts: ["phone"] });
    const b = task({ id: 2, contexts: [] });
    const c = task({ id: 3, contexts: ["store", "home"] }); // keys off "home"
    expect(sortTasks([a, b, c], "contexts").map((t) => t.id)).toEqual([3, 1, 2]);
  });

  it("desc reverses a comparator sort, putting missing-key tasks first", () => {
    const a = task({ id: 1, priority: "B" });
    const b = task({ id: 2, priority: null });
    const c = task({ id: 3, priority: "A" });
    // asc is [A, B, missing] = [3, 1, 2]; desc negates the comparator => [2, 1, 3].
    expect(sortTasks([a, b, c], "priority", "desc").map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("desc on file order returns the backend order reversed", () => {
    const tasks = [task({ id: 1 }), task({ id: 2 }), task({ id: 3 })];
    expect(sortTasks(tasks, "file", "desc").map((t) => t.id)).toEqual([3, 2, 1]);
  });

  it("omitting the direction defaults to ascending", () => {
    const a = task({ id: 1, priority: "B" });
    const c = task({ id: 3, priority: "A" });
    expect(sortTasks([a, c], "priority")).toEqual(sortTasks([a, c], "priority", "asc"));
  });

  it("never mutates the input array (asc comparator, desc comparator, file desc)", () => {
    const tasks = [task({ id: 1, priority: "B" }), task({ id: 2, priority: "A" })];
    const before = tasks.map((t) => t.id);
    sortTasks(tasks, "priority");
    sortTasks(tasks, "priority", "desc");
    sortTasks(tasks, "file", "desc");
    expect(tasks.map((t) => t.id)).toEqual(before);
  });

  it("offers exactly the file/priority/due/created/projects/contexts sorts (no alpha)", () => {
    expect(Object.keys(SORTS)).toEqual(["file", "priority", "due", "created", "projects", "contexts"]);
  });
});
