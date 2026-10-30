import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activateTransport, type Task } from "../api";
import { deferred, settle } from "../test/deferred";
import { RemoteUpdates, type Resource, type Snapshots } from "./remoteUpdates";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const instances: RemoteUpdates[] = [];
function setup() {
  const content: Snapshots = { note: "A", tasks: [] };
  const read = vi.fn(async <K extends Resource>(resource: K): Promise<Snapshots[K]> => content[resource]);
  const updates = new RemoteUpdates(read);
  instances.push(updates);
  return { updates, read, content };
}
beforeEach(() => { localStorage.setItem("ntr.serverUrl", "http://shared"); activateTransport(); });
afterEach(() => { instances.splice(0).forEach((updates) => updates.cancel()); localStorage.clear(); vi.useRealTimers(); });

describe("remote approval ownership", () => {
  it("coalesces identical signals, defers without resolving, and reviews the same snapshot", async () => {
    const { updates, content } = setup();
    updates.register("note", "A");
    await settle();
    content.note = "B";
    updates.request("note"); await settle();
    const offer = updates.state("note").pending!;
    updates.defer("note");
    updates.request("note"); await settle();
    expect(updates.state("note").pending).toBe(offer);
    expect(updates.state("note").phase).toBe("deferred");
    expect(updates.accepted("note")).toBe("A");
    await updates.review("note");
    const token = await updates.prepare(offer);
    const paint = vi.fn();
    expect(updates.commit(token!, paint)).toBe(true);
    expect(paint).toHaveBeenCalledWith("B");
    expect(updates.accepted("note")).toBe("B");
    expect(updates.state("note").phase).toBe("idle");
  });

  it("requires another choice for changed content and detects empty notes and task deletion/ID reassignment", async () => {
    const { updates, content } = setup();
    const task = { id: 1, raw: "task" } as Task;
    content.tasks = [task];
    updates.register("tasks", [task]); updates.register("note", "A"); await settle();
    content.note = "B";
    updates.request("note"); await settle();
    const old = updates.state("note").pending!;
    content.note = "";
    expect(await updates.prepare(old)).toBeNull();
    expect(updates.state("note").pending?.snapshot).toBe("");
    expect(updates.accepted("note")).toBe("A");
    content.tasks = [{ ...task, id: 2 }]; updates.request("tasks"); await settle();
    expect(updates.state("tasks").phase).toBe("offered");
    content.tasks = []; updates.request("tasks"); await settle();
    expect(updates.state("tasks").pending?.snapshot).toEqual([]);
  });

  it.each([false, true])("invalidates a pre-write GET and retains foreign content (foreign=%s)", async (foreign) => {
    const { updates, read, content } = setup();
    updates.register("note", "A"); await settle();
    const old = deferred<string>();
    read.mockImplementationOnce(() => old.promise as Promise<never>);
    updates.request("note");
    const done = updates.begin("note");
    updates.request("note"); // retain evidence while the write is running
    content.note = foreign ? "C" : "B";
    done("B");
    old.resolve("A"); await settle();
    expect(updates.accepted("note")).toBe("B");
    expect(updates.state("note").pending?.snapshot).toBe(foreign ? "C" : undefined);
    expect(read.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("does not erase a different pending version on local settlement or accept uncertain writes", async () => {
    const { updates, read, content } = setup();
    updates.register("note", "A"); await settle();
    content.note = "C"; updates.request("note"); await settle();
    const pending = updates.state("note").pending;
    const held = deferred<string>(); read.mockImplementationOnce(() => held.promise as Promise<never>);
    const done = updates.begin("note"); done("B");
    expect(updates.state("note").pending).toBe(pending);
    const failed = updates.begin("note"); failed();
    held.resolve("A"); await settle();
    expect(updates.accepted("note")).toBe("B");
    expect(updates.state("note").pending?.snapshot).toBe("C");
  });

  it("invalidates prepared and in-flight applications on mutation, supersession, and unmount", async () => {
    const { updates, content } = setup();
    updates.register("note", "A"); await settle();
    content.note = "B"; updates.request("note"); await settle();
    const token = await updates.prepare(updates.state("note").pending!);
    const done = updates.begin("note");
    expect(updates.commit(token!, vi.fn())).toBe(false);
    done(); await settle();
    const next = await updates.prepare(updates.state("note").pending!);
    content.note = "C"; updates.request("note"); await settle();
    expect(updates.commit(next!, vi.fn())).toBe(false);
    const last = await updates.prepare(updates.state("note").pending!);
    updates.cancel();
    expect(updates.commit(last!, vi.fn())).toBe(false);
    expect(updates.accepted("note")).toBe("A");
  });

  it("carries deferred state across transport replacement, but resets on destination changes", async () => {
    const { updates, content } = setup();
    updates.register("note", "A"); await settle();
    content.note = "B"; updates.request("note"); await settle();
    updates.defer("note");
    localStorage.setItem("ntr.allowInvalidCert", "1");
    updates.activate(activateTransport()); await settle();
    expect(updates.accepted("note")).toBe("A");
    expect(updates.state("note").phase).toBe("deferred");
    localStorage.setItem("ntr.serverUrl", "http://other");
    updates.activate(activateTransport());
    expect(updates.accepted("note")).toBeUndefined();
    expect(updates.state("note").pending).toBeUndefined();
  });

  it("retains offers on failed reads, allows retry, and ignores duplicate acceptance", async () => {
    const { updates, content, read } = setup();
    updates.register("note", "A"); await settle();
    content.note = "B"; updates.request("note"); await settle();
    const offer = updates.state("note").pending!;
    read.mockRejectedValueOnce(new Error("offline"));
    expect(await updates.prepare(offer)).toBeNull();
    expect(updates.state("note").error).toContain("offline");
    expect(updates.state("note").pending).toBe(offer);
    const first = updates.prepare(offer);
    expect(await updates.prepare(offer)).toBeNull();
    const token = await first;
    expect(updates.commit(token!, () => { throw new Error("paint failed"); })).toBe(false);
    expect(updates.accepted("note")).toBe("A");
    expect(updates.state("note").phase).toBe("offered");
    expect(updates.state("note").error).toBe("paint failed");
    updates.commit(token!, () => {});
    expect(updates.commit(token!, vi.fn())).toBe(false);
  });

  it("keeps an event during delayed initialization and independently resolves resources", async () => {
    const { updates, content } = setup();
    updates.request("note");
    content.note = "new";
    updates.register("note", "A"); updates.register("tasks", []); await settle();
    expect(updates.state("note").pending?.snapshot).toBe("new");
    expect(updates.state("tasks").phase).toBe("idle");
    content.note = "A"; updates.request("note"); await settle();
    expect(updates.state("note").pending).toBeUndefined();
  });
});
