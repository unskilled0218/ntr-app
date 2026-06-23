import { describe, expect, it } from "vitest";
import { cmpMissingLast, sortTasks } from "./config";
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
});
