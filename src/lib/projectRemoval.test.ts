import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateTransport, captureTransport, type Labels, type Task } from "../api";
import { removeProjectText } from "../labels";
import { ProjectReviewRequired } from "./projectRename";
import { ProjectRemoval, type ProjectRemovalPorts } from "./projectRemoval";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const task = (id: number, raw = `task${id} +work`): Task => ({ id, raw, description: raw, projects: raw.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1)), contexts: [], tags: {}, completed: false, completion_date: null, creation_date: null });
function fixture() {
  const data = { tasks: [task(1), task(2)], labels: { project: ["work", "other"], context: ["phone"] } as Labels, current: true };
  const ports: ProjectRemovalPorts = {
    validate: vi.fn(async () => data.tasks), labels: vi.fn(async () => data.labels),
    write: vi.fn(async (id, raw) => { const updated = task(id, raw); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated; }),
    saveLabels: vi.fn(async (labels) => { data.labels = labels; }), current: () => data.current,
    completed: vi.fn(), changed: vi.fn(),
  };
  const context = captureTransport();
  return { data, ports, context, operation: new ProjectRemoval("work", context, ports) };
}
beforeEach(() => { localStorage.setItem("ntr.serverUrl", "http://shared"); activateTransport(); });
afterEach(() => localStorage.clear());

describe("retained project removal", () => {
  it("removes only exact project tokens and preserves unrelated metadata", () => {
    expect(removeProjectText("x (B) 2026-10-30 2026-01-01 task +work\t+workshop @home due:2026-11-01", "work"))
      .toBe("x (B) 2026-10-30 2026-01-01 task +workshop @home due:2026-11-01");
    expect(removeProjectText("  unrelated  ", "work")).toBe("  unrelated  ");
  });
  it("verifies tasks and labels before publishing completion", async () => {
    const { data, ports, operation, context } = fixture();
    expect(await operation.run(context)).toBe("completed");
    expect(data.tasks.map((found) => found.raw)).toEqual(["task1", "task2"]);
    expect(data.labels).toEqual({ project: ["other"], context: ["phone"] });
    expect(ports.completed).toHaveBeenCalledTimes(1);
  });
  it("retains a partial write and retries only remaining tasks", async () => {
    const { ports, operation, context, data } = fixture();
    vi.mocked(ports.write).mockImplementation(async (id, raw) => {
      if (id === 2) throw new Error("offline");
      const updated = task(id, raw); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated;
    });
    expect(await operation.run(context)).toBe("partial");
    expect(operation.done.size).toBe(1); expect(ports.completed).not.toHaveBeenCalled();
    vi.mocked(ports.write).mockImplementation(async (id, raw) => { const updated = task(id, raw); data.tasks = data.tasks.map((found) => found.id === id ? updated : found); return updated; });
    await operation.run(context);
    expect(operation.phase).toBe("completed");
    expect(vi.mocked(ports.write).mock.calls.map(([id]) => id)).toEqual([1, 2, 2]);
  });
  it.each([false, true])("retries labels without task replay after an uncertain PUT (committed=%s)", async (committed) => {
    const { data, ports, operation, context } = fixture();
    vi.mocked(ports.saveLabels).mockImplementationOnce(async (labels) => { if (committed) data.labels = labels; throw new Error("lost response"); });
    await operation.run(context); expect(operation.phase).toBe("labels-pending");
    await operation.run(context);
    expect(operation.phase).toBe("completed"); expect(ports.write).toHaveBeenCalledTimes(2);
    expect(ports.saveLabels).toHaveBeenCalledTimes(committed ? 1 : 2);
  });
  it("never substitutes empty labels after a failed GET", async () => {
    const { ports, operation, context } = fixture();
    vi.mocked(ports.labels).mockRejectedValueOnce(new Error("read failed"));
    await operation.run(context); expect(operation.phase).toBe("failed");
    expect(ports.write).not.toHaveBeenCalled(); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
  it("does not emit completion on foreign divergence or resume without explicit retry", async () => {
    const { ports, operation, context } = fixture();
    vi.mocked(ports.validate).mockRejectedValueOnce(new ProjectReviewRequired());
    await operation.run(context); expect(operation.phase).toBe("paused-for-review"); expect(ports.completed).not.toHaveBeenCalled();
    await operation.run(context); expect(operation.phase).toBe("completed");
  });
  it("does not accept an unexpected label mixture as completion", async () => {
    const { data, ports, operation, context } = fixture();
    vi.mocked(ports.saveLabels).mockImplementationOnce(async (labels) => { data.labels = { ...labels, context: [] }; });
    await operation.run(context); expect(operation.phase).toBe("labels-pending"); expect(ports.completed).not.toHaveBeenCalled();
    await operation.run(context); expect(ports.saveLabels).toHaveBeenCalledTimes(1);
  });
  it("stops after destination invalidation", async () => {
    const { ports, operation, context } = fixture();
    vi.mocked(ports.labels).mockImplementationOnce(async () => { localStorage.setItem("ntr.serverUrl", "http://other"); activateTransport(); return { project: ["work"], context: [] }; });
    await operation.run(context); expect(ports.write).not.toHaveBeenCalled(); expect(ports.saveLabels).not.toHaveBeenCalled();
  });
});
