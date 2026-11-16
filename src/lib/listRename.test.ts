import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateTransport, captureTransport, type Labels, type Task } from "../api";
import { parseLabelInput, planListRename, renameListNames, renameListText } from "../labels";
import { ListRename, ListReviewRequired, type ListRenamePorts } from "./listRename";
import { deferred, settle } from "../test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const task = (id: number, raw = `task${id} +old`): Task => ({ id, raw, description: raw, lists: raw.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1)), contexts: [], tags: {}, completed: false, completion_date: null, creation_date: null });
function setup(tasks = [task(1), task(2)]) {
  const data = { tasks, labels: { list: ["old", "other"], context: ["phone"] } as Labels, current: true, staged: [] as string[] };
  const ports: ListRenamePorts = {
    validate: vi.fn(async () => data.tasks),
    write: vi.fn(async (id, text) => { const updated = task(id, text); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated; }),
    labels: vi.fn(async () => data.labels), saveLabels: vi.fn(async (labels) => { data.labels = labels; }),
    current: () => data.current, staged: () => data.staged, changed: vi.fn(), completed: vi.fn(),
  };
  const context = captureTransport();
  const operation = new ListRename("old", "new", context, ports);
  return { operation, ports, context, data };
}
beforeEach(() => { localStorage.setItem("ntr.serverUrl", "http://shared"); activateTransport(); });
afterEach(() => localStorage.clear());

describe("pure list renaming", () => {
  it.each(["", "new name", "new:name", "new@name", "new+name"])("rejects invalid target %j", (name) => expect(parseLabelInput(name)).toHaveProperty("error"));
  it("normalizes sigils and preserves every unrelated token and separator", () => {
    expect(parseLabelInput(" +@new ")).toEqual({ name: "new" });
    const raw = "x (B) 2026-10-30 2026-01-01 task\t+old  +old +oldish +other @home pri:A due:2026-11-01 updated:2026-09-01 https://host/+old";
    expect(renameListText(raw, "old", "new")).toBe(raw.replace(/\+old(?=\s)/g, "+new"));
    expect(renameListText("old +Old +old", "old", "new")).toBe("old +Old +new");
    expect(renameListNames(["old", "other", "old"], "old", "new")).toEqual(["new", "other"]);
    expect(planListRename([task(1), task(2, "plain +oldish")], "old", "new")).toEqual([{ id: 1, expected: "task1 +old", text: "task1 +new" }]);
  });
});

describe("scoped rename progress", () => {
  it("completes multiple tasks despite its own target references and preserves labels", async () => {
    const { operation, ports, context, data } = setup();
    await operation.run(context);
    expect(operation.phase).toBe("completed");
    expect(data.tasks.map((found) => found.raw)).toEqual(["task1 +new", "task2 +new"]);
    expect(data.labels).toEqual({ list: ["new", "other"], context: ["phone"] });
    expect(ports.saveLabels).toHaveBeenCalledTimes(1);
  });
  it("same-name confirmation performs no IO", async () => {
    const { ports, context } = setup();
    await new ListRename("old", "old", context, ports).run(context);
    expect(ports.validate).not.toHaveBeenCalled(); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it.each(["tasks", "labels", "staged"])("rejects an initial collision in %s without writes", async (where) => {
    const { operation, ports, context, data } = setup();
    if (where === "tasks") data.tasks.push(task(3, "existing +new"));
    if (where === "labels") data.labels.list.push("new");
    if (where === "staged") data.staged.push("new");
    await operation.run(context);
    expect(operation.phase).toBe("failed"); expect(ports.write).not.toHaveBeenCalled(); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it("renames a remembered-only list", async () => {
    const { operation, ports, context, data } = setup([]);
    await operation.run(context);
    expect(operation.phase).toBe("completed"); expect(ports.write).not.toHaveBeenCalled(); expect(data.labels.list).toEqual(["new", "other"]);
  });
  it("retries only remaining tasks after a failure", async () => {
    const { operation, ports, context, data } = setup();
    // The first acknowledged response is reflected in storage; the second response fails.
    vi.mocked(ports.write).mockImplementation(async (id, text) => {
      if (id === 2) throw new Error("offline");
      const updated = task(id, text); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated;
    });
    await operation.run(context);
    expect(operation.done.size).toBe(1); expect(operation.phase).toBe("failed");
    vi.mocked(ports.write).mockImplementation(async (id, text) => { const updated = task(id, text); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated; });
    await operation.run(context);
    expect(operation.phase).toBe("completed");
    expect(vi.mocked(ports.write).mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  });
  it.each([false, true])("resolves label-only retry, including uncertain committed PUT (committed=%s)", async (committed) => {
    const { operation, ports, context, data } = setup();
    vi.mocked(ports.saveLabels).mockImplementationOnce(async (labels) => { if (committed) data.labels = labels; throw new Error("lost response"); });
    await operation.run(context);
    expect(operation.phase).toBe("labels-pending");
    await operation.run(context);
    expect(operation.phase).toBe("completed"); expect(ports.write).toHaveBeenCalledTimes(2);
    expect(ports.saveLabels).toHaveBeenCalledTimes(committed ? 1 : 2);
  });
  it("stops at a new target reference instead of treating it as own progress", async () => {
    const { operation, ports, context, data } = setup();
    vi.mocked(ports.validate).mockImplementation(async () => {
      if (operation.done.size) data.tasks = [...data.tasks.filter((found) => found.id !== 9), task(9, "foreign +new")];
      return data.tasks;
    });
    await operation.run(context);
    expect(operation.done.size).toBe(1); expect(operation.phase).toBe("failed"); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it("does not resume after foreign review without an explicit run", async () => {
    const { operation, ports, context } = setup();
    vi.mocked(ports.validate).mockRejectedValueOnce(new ListReviewRequired());
    await operation.run(context);
    expect(operation.phase).toBe("paused-for-review"); await settle();
    expect(ports.write).not.toHaveBeenCalled();
    await operation.run(context); expect(operation.phase).toBe("completed");
  });
  it.each(["transport", "unmount"])("retains settled evidence but stops writes after %s invalidation", async (change) => {
    const { operation, ports, context, data } = setup();
    const held = deferred<Task>(); vi.mocked(ports.write).mockReturnValueOnce(held.promise);
    const run = operation.run(context); await settle();
    if (change === "transport") { localStorage.setItem("ntr.serverUrl", "http://other"); activateTransport(); } else data.current = false;
    held.resolve(task(1, "task1 +new")); await run;
    expect(operation.done.size).toBe(1); expect(ports.write).toHaveBeenCalledTimes(1); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it("does not overwrite an unexplained mixture after an uncertain label write", async () => {
    const { operation, ports, context, data } = setup([]);
    vi.mocked(ports.saveLabels).mockImplementationOnce(async () => { data.labels = { list: ["old", "new"], context: [] }; throw new Error("uncertain"); });
    await operation.run(context); await operation.run(context);
    expect(operation.phase).toBe("labels-pending"); expect(ports.saveLabels).toHaveBeenCalledTimes(1);
  });
  it("preserves unrelated labels added before the final read", async () => {
    const { operation, ports, context, data } = setup();
    vi.mocked(ports.labels).mockImplementation(async () => {
      if (operation.done.size === 2 && !data.labels.list.includes("new")) data.labels = { list: ["old", "other", "fresh"], context: ["phone", "freshContext"] };
      return data.labels;
    });
    await operation.run(context);
    expect(operation.phase).toBe("completed");
    expect(data.labels).toEqual({ list: ["new", "other", "fresh"], context: ["phone", "freshContext"] });
  });
  it("detects a legacy writer restoring old labels after PUT instead of declaring success", async () => {
    const { operation, ports, context } = setup([]);
    vi.mocked(ports.saveLabels).mockResolvedValue(); // Another writer leaves the pre-write labels visible.
    await operation.run(context);
    expect(operation.phase).toBe("labels-pending"); expect(ports.completed).not.toHaveBeenCalled();
  });
  it("resolves an uncertain committed task only on an explicit retry", async () => {
    const { operation, ports, context, data } = setup([task(1)]);
    vi.mocked(ports.write).mockImplementationOnce(async (id, raw) => { data.tasks = [task(id, raw)]; throw new Error("lost task response"); });
    await operation.run(context); expect(operation.phase).toBe("failed"); expect(operation.done.size).toBe(0);
    await operation.run(context);
    expect(operation.phase).toBe("completed"); expect(ports.write).toHaveBeenCalledTimes(1); expect(operation.done.size).toBe(1);
  });
  it("does not carry write authority to a different destination on retry", async () => {
    const { operation, ports, context } = setup();
    vi.mocked(ports.write).mockRejectedValueOnce(new Error("offline")); await operation.run(context);
    localStorage.setItem("ntr.serverUrl", "http://different"); const other = activateTransport();
    await operation.run(other);
    expect(ports.write).toHaveBeenCalledTimes(1); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it("does not mistake duplicate verification values for a preserved unrelated context", async () => {
    const { operation, ports, context, data } = setup([]);
    data.labels.context = ["phone", "important"];
    vi.mocked(ports.saveLabels).mockImplementation(async (labels) => { data.labels = { ...labels, context: ["phone", "phone"] }; });
    await operation.run(context);
    expect(operation.phase).toBe("labels-pending"); expect(ports.completed).not.toHaveBeenCalled();
  });
});
