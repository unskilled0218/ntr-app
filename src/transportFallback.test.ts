import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { activateTransport, canMutate, captureTransport, completeTask, createTask, deleteTask, endTransportSession, errMsg, getLabels, getNote, isTransportCurrent, listTasks, markResourceReady, putLabels, putNote, reconcileWithServer, reconnectTransport, startTransportSession, subscribeTransport, transportStatus, uncompleteTask, updateTask, usingLocalFallback } from "./api";
import { deferred, settle } from "./test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const unavailable = { kind: "connection", message: "error sending request for url (server-url)" };
const response = (body: string, status = 200) => ({ ok: status === 200, status, status_text: "Unavailable", body });
let note: string;
let raw: string;
let remoteNote: string;
let remoteRaw: string;
let failPath: string;
let attempted: string[];

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ntr.serverUrl", "http://saved-server");
  note = "local note"; raw = "local task\n";
  remoteNote = note; remoteRaw = raw; failPath = ""; attempted = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "get_note") return note;
    if (command === "get_raw") return raw;
    if (command === "get_labels") return { project: ["local"], context: [] };
    if (command === "list_tasks") return [];
    if (command === "put_note") { note = (args as { text: string }).text; return; }
    if (command === "put_raw") { raw = (args as { text: string }).text; return; }
    if (command === "server_fetch") {
      const req = (args as { req: { url: string; method: string; body: string } }).req;
      const path = new URL(req.url).pathname;
      if (path === "/api/capabilities") return { ok: false, status: 404, status_text: "Not Found", body: "" };
      attempted.push(`${req.method} ${path}`);
      if (path === failPath) throw unavailable;
      if (req.method !== "GET") {
        if (path === "/api/note") remoteNote = req.body;
        else remoteRaw = req.body;
        return response(req.method === "POST" ? JSON.stringify({ id: 1, description: req.body, raw: req.body, projects: [], contexts: [], tags: {}, completed: false, completion_date: null, creation_date: null }) : "");
      }
      return response(path === "/api/note" ? remoteNote : path === "/api/raw" ? remoteRaw : "[]");
    }
  });
  startTransportSession();
});
afterEach(async () => { endTransportSession(); await settle(); localStorage.clear(); vi.restoreAllMocks(); });

async function readyServer() {
  await reconcileWithServer();
  markResourceReady("note", captureTransport());
  markResourceReady("tasks", captureTransport());
}

it("uses one whole-app local destination without deleting saved connection settings", async () => {
  await readyServer();
  localStorage.setItem("ntr.allowInvalidCert", "1");
  activateTransport();
  failPath = "/api/labels";
  const old = captureTransport();
  await expect(getLabels()).rejects.toEqual(unavailable);
  expect(usingLocalFallback()).toBe(true);
  expect(isTransportCurrent(old)).toBe(false);
  expect(captureTransport()).toMatchObject({ url: "", configuredUrl: "http://saved-server", allowInvalidCert: true });
  expect(localStorage.getItem("ntr.serverUrl")).toBe("http://saved-server");
  expect(canMutate("tasks")).toBe(false);
  await reconcileWithServer();
  expect(await getNote()).toBe("local note");
  expect(await getLabels()).toEqual({ project: ["local"], context: [] });
  expect(await listTasks({})).toEqual([]);
  markResourceReady("note", captureTransport());
  markResourceReady("tasks", captureTransport());
  await putNote("edited offline");
  await putLabels({ project: ["offline"], context: [] });
  expect(note).toBe("edited offline");
  expect(attempted.every((request) => request.startsWith("GET"))).toBe(true);
});

it.each(["ask", "server", "local"].flatMap((strategy) => ["", "different remote note"].map((text) => [strategy, text])))("does not apply a note before failed task discovery (%s, %j)", async (strategy, text) => {
  localStorage.setItem("ntr.conflictStrategy", strategy);
  remoteNote = text;
  failPath = "/api/raw";
  await expect(reconcileWithServer()).rejects.toEqual(unavailable);
  expect(note).toBe("local note");
  expect(raw).toBe("local task\n");
  expect(remoteNote).toBe(text);
  expect(attempted).toEqual(["GET /api/note", "GET /api/raw"]);
  expect(vi.mocked(invoke).mock.calls.some(([command]) => command.startsWith("put_"))).toBe(false);
});

it("closes all mutation entry points synchronously, even with fresh contexts", async () => {
  const operations = [() => createTask("draft"), () => updateTask(1, "draft"), () => completeTask(1), () => uncompleteTask(1), () => deleteTask(1), () => putNote("draft"), () => putLabels({ project: [], context: [] })];
  for (const operation of operations) await expect(operation()).rejects.toThrow("still loading");
  expect(vi.mocked(invoke)).not.toHaveBeenCalled();
  await readyServer();
  reconnectTransport();
  for (const operation of operations) await expect(operation()).rejects.toThrow("still loading");
});

it("coalesces simultaneous failures and ignores a stale failure from another server", async () => {
  const first = deferred<never>();
  const second = deferred<never>();
  vi.mocked(invoke).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const a = getNote().catch(() => {});
  const b = getLabels().catch(() => {});
  const listener = vi.fn();
  const unsubscribe = subscribeTransport(listener);
  first.reject(unavailable); second.reject(unavailable);
  await Promise.all([a, b]);
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
  reconnectTransport();
  const stale = deferred<never>();
  vi.mocked(invoke).mockReturnValueOnce(stale.promise);
  const work = getNote().catch(() => {});
  localStorage.setItem("ntr.serverUrl", "http://other-server");
  reconnectTransport();
  stale.reject(unavailable); await work;
  expect(usingLocalFallback()).toBe(false);
  expect(captureTransport().url).toBe("http://other-server");
});

it.each(["note", "tasks", "labels"])("drains an already-admitted native %s backup before local reads or editing", async (resource) => {
  await readyServer();
  const commit = deferred<void>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  const command = resource === "note" ? "put_note" : resource === "tasks" ? "put_raw" : "put_labels";
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === command) { await commit.promise; return original(name, args); }
    return original(name, args);
  });
  const save = resource === "note" ? putNote("old backup") : resource === "labels" ? putLabels({ project: ["old"], context: [] }) : createTask("old task");
  await settle();
  failPath = "/api/labels";
  await expect(getLabels()).rejects.toEqual(unavailable);
  const initializing = reconcileWithServer();
  const read = vi.fn();
  const reading = getNote().then(read);
  await settle();
  expect(transportStatus()).toBe("Waiting for local storage");
  expect(canMutate("note")).toBe(false);
  expect(read).not.toHaveBeenCalled();
  await expect(putNote("too early")).rejects.toThrow("still loading");
  commit.resolve();
  await Promise.all([save, initializing, reading]);
  markResourceReady("note", captureTransport());
  await putNote("new local edit");
  expect(note).toBe("new local edit");
});

it("orders a pending local save before explicit reconnect discovery", async () => {
  failPath = "/api/note";
  await expect(getNote()).rejects.toEqual(unavailable);
  await reconcileWithServer();
  markResourceReady("note", captureTransport());
  const commit = deferred<void>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === "put_note") await commit.promise;
    return original(name, args);
  });
  const save = putNote("offline save");
  await settle();
  failPath = "";
  reconnectTransport();
  const work = reconcileWithServer();
  const count = attempted.length;
  await settle(); expect(attempted).toHaveLength(count);
  commit.resolve(); await save;
  expect(await work).toContainEqual({ resource: "note", local: "offline save", server: "local note" });
});

it("does not redirect an uncertain server mutation to local files", async () => {
  await readyServer();
  failPath = "/api/note";
  await expect(putNote("uncertain")).rejects.toEqual(unavailable);
  expect(usingLocalFallback()).toBe(false);
  expect(note).toBe("local note");
});

it.each([401, 404, 503])("preserves HTTP %s errors without switching stores", async (status) => {
  vi.mocked(invoke).mockResolvedValueOnce(response("", status));
  await expect(getNote()).rejects.toThrow(`${status} Unavailable`);
  expect(usingLocalFallback()).toBe(false);
});

it("reports partial application and reclassifies a mutation that committed despite its failed response", async () => {
  localStorage.setItem("ntr.conflictStrategy", "local");
  remoteNote = "remote note"; remoteRaw = "remote tasks";
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    const result = await original(name, args);
    if (name === "server_fetch") {
      const req = (args as { req: { url: string; method: string } }).req;
      if (req.method === "PUT" && req.url.endsWith("/api/raw")) throw unavailable;
    }
    return result;
  });
  await expect(reconcileWithServer()).rejects.toEqual(unavailable);
  expect(remoteNote).toBe(note); expect(remoteRaw).toBe(raw);
  expect(transportStatus()).toContain("note: applied local copy");
  expect(transportStatus()).toContain("tasks: outcome unknown (local)");
  expect(canMutate("tasks")).toBe(false);
  reconnectTransport();
  const count = attempted.filter((request) => request.startsWith("PUT")).length;
  await reconcileWithServer();
  expect(attempted.filter((request) => request.startsWith("PUT"))).toHaveLength(count);
});

it("normalizes structured native messages and initializes a new session at the same URL", async () => {
  expect(errMsg(unavailable)).toBe(unavailable.message);
  failPath = "/api/note";
  await expect(getNote()).rejects.toEqual(unavailable);
  endTransportSession(); startTransportSession();
  failPath = "";
  await readyServer();
  expect(usingLocalFallback()).toBe(false);
  expect(canMutate("note")).toBe(true);
});

it("surfaces a failed admitted native backup, rereads storage, and only then allows local editing", async () => {
  await readyServer();
  const commit = deferred<void>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args) => name === "put_note" ? commit.promise : original(name, args));
  const save = putNote("backup that fails");
  await settle();
  failPath = "/api/labels";
  await getLabels().catch(() => {});
  const work = reconcileWithServer();
  await settle();
  expect(canMutate("note")).toBe(false);
  commit.reject("disk full");
  await Promise.all([save, work]);
  expect(await getNote()).toBe("local note");
  expect(transportStatus()).toContain("Local storage write failed: disk full");
  markResourceReady("note", captureTransport());
  expect(canMutate("note")).toBe(true);
});

it("never admits a late successful server mutation's backup after fallback", async () => {
  await readyServer();
  const write = deferred<ReturnType<typeof response>>();
  vi.mocked(invoke).mockReturnValueOnce(write.promise);
  const saving = putNote("old server save");
  failPath = "/api/labels";
  await getLabels().catch(() => {});
  await reconcileWithServer();
  markResourceReady("note", captureTransport());
  await putNote("new local save");
  write.resolve(response("")); await saving;
  expect(note).toBe("new local save");
  expect(vi.mocked(invoke).mock.calls.filter(([name]) => name === "put_note")).toHaveLength(1);
});

it("retains a completed local note adoption after a later task application failure", async () => {
  localStorage.setItem("ntr.conflictStrategy", "server");
  remoteNote = ""; remoteRaw = "different remote tasks";
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args) => name === "put_raw" ? Promise.reject("task write failed") : original(name, args));
  await expect(reconcileWithServer()).rejects.toBe("task write failed");
  expect(note).toBe("");
  expect(raw).toBe("local task\n");
  expect(transportStatus()).toContain("note: applied server copy");
  expect(transportStatus()).toContain("tasks: outcome unknown (server)");
  expect(canMutate("note")).toBe(false);
});
