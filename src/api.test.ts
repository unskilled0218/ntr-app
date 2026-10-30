import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  activateTransport,
  captureTransport,
  completeTask,
  createTask,
  deleteTask,
  errMsg,
  getLabels,
  getNote,
  listTasks,
  onChange,
  putNote,
  putLabels,
  reconcileWithServer,
  resolveConflict,
  uncompleteTask,
  updateTask,
} from "./api";
import { deferred, settle } from "./test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

// --- errMsg (transport-independent) ---

describe("errMsg", () => {
  it("uses an Error's message", () => {
    expect(errMsg(new Error("x"))).toBe("x");
  });

  it("stringifies a non-Error (IPC rejections arrive as plain strings)", () => {
    expect(errMsg("y")).toBe("y");
  });
});

// --- Server mode ---
// Server-mode requests now go through the Rust `server_fetch` command (not a webview fetch),
// and the local backups go through `invoke` too — so a single `invoke` mock dispatches both:
// `server_fetch` dequeues the next queued HttpResponse; `get_note`/`get_raw` return the local
// copy; every other command (put_note/put_raw/server_connect/...) resolves to undefined.

const SERVER = "http://test-server";

const TASK = {
  id: 1,
  completed: false,
  priority: null,
  completion_date: null,
  creation_date: null,
  description: "test",
  projects: [],
  contexts: [],
  tags: {},
  raw: "test",
};

const REASON: Record<number, string> = {
  200: "OK",
  204: "No Content",
  404: "Not Found",
  500: "Internal Server Error",
};

// Build the HttpResponse shape the Rust command returns. 204/null bodies serialise to "".
function httpResp(body: unknown, status = 200) {
  const serialised =
    body === null || body === undefined || status === 204
      ? ""
      : typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, status_text: REASON[status] ?? "", body: serialised };
}

// Wire the invoke mock: `serverResponses` are dequeued in order for successive `server_fetch`
// calls; `local` supplies get_note/get_raw. Each spec is [body, status?].
function mockServer(
  serverResponses: Array<[body: unknown, status?: number]> = [],
  local: { note?: string; raw?: string } = {},
): ReturnType<typeof vi.fn> {
  const queue = serverResponses.map(([b, s]) => httpResp(b, s));
  let i = 0;
  const mock = vi.mocked(invoke);
  mock.mockImplementation((cmd: string) => {
    if (cmd === "server_fetch") return Promise.resolve(queue[i++]);
    if (cmd === "get_note") return Promise.resolve(local.note ?? "");
    if (cmd === "get_raw") return Promise.resolve(local.raw ?? "");
    return Promise.resolve(undefined);
  });
  return mock;
}

// The `req` of the nth `server_fetch` invoke call.
function reqOf(call: number): { url: string; method: string; body: string | null; contentType: string | null; allowInvalidCert: boolean } {
  const calls = vi.mocked(invoke).mock.calls.filter((c) => c[0] === "server_fetch");
  return (calls[call][1] as { req: ReturnType<typeof reqOf> }).req;
}

beforeEach(() => {
  localStorage.setItem("ntr.serverUrl", SERVER);
});

afterEach(() => {
  localStorage.clear();
  vi.mocked(invoke).mockReset();
});

describe("listTasks (server mode)", () => {
  it("calls GET /api/tasks with no params, no body, and the cert flag", async () => {
    mockServer([[[TASK]]]);
    const result = await listTasks({});
    expect(result).toEqual([TASK]);
    expect(reqOf(0)).toEqual({
      url: `${SERVER}/api/tasks`,
      method: "GET",
      body: null,
      contentType: null,
      allowInvalidCert: false,
    });
  });

  it("passes allowInvalidCert: true when the setting is on", async () => {
    localStorage.setItem("ntr.allowInvalidCert", "1");
    mockServer([[[]]]);
    await listTasks({});
    expect(reqOf(0).allowInvalidCert).toBe(true);
  });

  it("appends only non-null filter params", async () => {
    mockServer([[[]]]);
    await listTasks({ completed: false, project: "work", context: null });
    const url = reqOf(0).url;
    expect(url).toContain("completed=false");
    expect(url).toContain("project=work");
    expect(url).not.toContain("context=");
    expect(url).not.toContain("priority=");
  });

  it("project-only requests do not restrict completion or context", async () => {
    mockServer([[[]]]);
    await listTasks({ project: "work" });
    expect(reqOf(0).url).toBe(`${SERVER}/api/tasks?project=work`);
  });
});

describe("listTasks (local mode)", () => {
  it("project-only requests pass null completion and context restrictions", async () => {
    localStorage.removeItem("ntr.serverUrl");
    vi.mocked(invoke).mockResolvedValueOnce([TASK]);
    await expect(listTasks({ project: "work" })).resolves.toEqual([TASK]);
    expect(invoke).toHaveBeenCalledWith("list_tasks", { completed: null, project: "work", context: null });
  });
});

describe("createTask (server mode)", () => {
  it("calls POST /api/tasks with a JSON body and Content-Type", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    const result = await createTask("buy milk");
    expect(result).toEqual(TASK);
    expect(reqOf(0)).toMatchObject({
      url: `${SERVER}/api/tasks`,
      method: "POST",
      body: JSON.stringify({ text: "buy milk" }),
      contentType: "application/json",
    });
  });
});

describe("updateTask (server mode)", () => {
  it("calls PUT /api/tasks/{id} with a JSON body", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await updateTask(1, "updated");
    expect(reqOf(0)).toMatchObject({
      url: `${SERVER}/api/tasks/1`,
      method: "PUT",
      body: JSON.stringify({ text: "updated" }),
      contentType: "application/json",
    });
  });

  it("roundtrips persisted dates and backs up the server's raw line without restamping", async () => {
    const raw = "2026-10-10 Do something +cart due:2026-10-12 custom:new updated:2026-10-11";
    const saved = { ...TASK, creation_date: "2026-10-10", description: raw.slice(11), projects: ["cart"], tags: { due: "2026-10-12", custom: "new", updated: "2026-10-11" }, raw };
    mockServer([[saved], [raw + "\n"]]);
    expect(await updateTask(1, raw)).toEqual(saved);
    expect(reqOf(0).body).toBe(JSON.stringify({ text: raw }));
    expect(invoke).toHaveBeenCalledWith("put_raw", { text: raw + "\n" });
  });

  it("sends the same canonical edit metadata through local transport", async () => {
    localStorage.removeItem("ntr.serverUrl");
    const raw = "2026-10-10 Do something +cart updated:2026-10-11";
    const saved = { ...TASK, creation_date: "2026-10-10", tags: { updated: "2026-10-11" }, raw };
    vi.mocked(invoke).mockResolvedValue(saved);
    expect(await updateTask(1, raw)).toEqual(saved);
    expect(invoke).toHaveBeenCalledWith("update_task", { id: 1, text: raw });
    expect(invoke).toHaveBeenCalledOnce();
  });
});

describe("completeTask (server mode)", () => {
  it("calls POST /api/tasks/{id}/complete with no body", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await completeTask(1);
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/tasks/1/complete`, method: "POST", body: null });
  });
});

describe("uncompleteTask (server mode)", () => {
  it("calls POST /api/tasks/{id}/uncomplete", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await uncompleteTask(1);
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/tasks/1/uncomplete`, method: "POST" });
  });
});

describe("deleteTask (server mode)", () => {
  it("calls DELETE /api/tasks/{id}", async () => {
    mockServer([[null, 204], [TASK.raw + "\n"]]);
    await deleteTask(1);
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/tasks/1`, method: "DELETE" });
  });
});

describe("getNote (server mode)", () => {
  it("calls GET /api/note and returns text", async () => {
    mockServer([["hello note"]]);
    const result = await getNote();
    expect(result).toBe("hello note");
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/note`, method: "GET" });
  });
});

describe("putNote (server mode)", () => {
  it("calls PUT /api/note with a plain-text body and Content-Type", async () => {
    mockServer([[null, 204]]);
    await putNote("my note text");
    expect(reqOf(0)).toMatchObject({
      url: `${SERVER}/api/note`,
      method: "PUT",
      body: "my note text",
      contentType: "text/plain",
    });
  });
});

describe("labels (server mode)", () => {
  const labels = { project: ["work"], context: ["phone"] };

  it("gets labels as JSON", async () => {
    mockServer([[labels]]);
    await expect(getLabels()).resolves.toEqual(labels);
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/labels`, method: "GET" });
  });

  it("puts labels as JSON and backs them up locally", async () => {
    mockServer([[null, 204]]);
    await putLabels(labels);
    expect(reqOf(0)).toMatchObject({
      url: `${SERVER}/api/labels`,
      method: "PUT",
      body: JSON.stringify(labels),
      contentType: "application/json",
    });
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_labels", { labels });
  });
});

describe("onChange (server mode)", () => {
  it("starts the SSE bridge, fires the handler on a change event, and tears down on unlisten", async () => {
    let captured: ((e: { payload: { connectionId: string; kind: string } }) => void) | undefined;
    const unlistenSpy = vi.fn();
    vi.mocked(listen).mockImplementation((_event, handler) => {
      captured = handler as typeof captured;
      return Promise.resolve(unlistenSpy);
    });
    mockServer();

    const received: string[] = [];
    const unlisten = await onChange((kind) => received.push(kind));

    expect(vi.mocked(invoke)).toHaveBeenCalledWith("server_connect", {
      url: `${SERVER}/api/events`,
      allowInvalidCert: false,
      connectionId: expect.any(String),
    });
    const connectionId = (vi.mocked(invoke).mock.calls[0][1] as { connectionId: string }).connectionId;
    captured!({ payload: { connectionId, kind: "tasks" } });
    captured!({ payload: { connectionId, kind: "note" } });
    expect(received).toEqual(["tasks", "note"]);

    unlisten();
    await Promise.resolve();
    expect(unlistenSpy).toHaveBeenCalled();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("server_disconnect", { connectionId });
  });
});

describe("HTTP error mapping", () => {
  it("throws a message with the status code and reason on a non-2xx response", async () => {
    mockServer([[null, 404]]);
    await expect(listTasks({})).rejects.toThrow("404 Not Found");
  });

  it("errMsg extracts the message from the thrown Error", async () => {
    mockServer([[null, 500]]);
    const err = await listTasks({}).catch((e: unknown) => e);
    expect(errMsg(err)).toContain("500");
  });
});

describe("live subscription ownership", () => {
  let callbacks: Array<(event: { payload: { connectionId: string; kind: string } }) => void>;
  let removers: Array<ReturnType<typeof vi.fn>>;
  beforeEach(() => {
    callbacks = [];
    removers = [];
    vi.mocked(listen).mockReset().mockImplementation((_event, handler) => {
      callbacks.push(handler as typeof callbacks[number]);
      const remove = vi.fn();
      removers.push(remove);
      return Promise.resolve(remove);
    });
    mockServer();
  });

  const id = () => {
    const calls = vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_connect");
    return (calls[calls.length - 1][1] as { connectionId: string }).connectionId;
  };

  it("installs the listener before connect and refreshes on every accepted connection", async () => {
    const changed = vi.fn();
    const connected = vi.fn();
    const cleanup = await onChange(changed, { onConnected: connected });
    expect(vi.mocked(listen).mock.calls[0][0]).toBe("server-live");
    expect(vi.mocked(listen).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(invoke).mock.invocationCallOrder[0]);
    for (const kind of ["connected", "tasks", "note", "connected"]) callbacks[0]({ payload: { connectionId: id(), kind } });
    callbacks[0]({ payload: { connectionId: "obsolete", kind: "tasks" } });
    expect(connected).toHaveBeenCalledTimes(2);
    expect(changed.mock.calls).toEqual([["tasks"], ["note"]]);
    cleanup();
    await settle();
  });

  it("aborts during listener setup without starting a bridge and releases the late listener", async () => {
    const listener = deferred<() => void>();
    const remove = vi.fn();
    vi.mocked(listen).mockReturnValueOnce(listener.promise);
    const controller = new AbortController();
    const setup = onChange(vi.fn(), { signal: controller.signal });
    controller.abort();
    listener.resolve(remove);
    const cleanup = await setup;
    cleanup();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("serializes an issued connect, aborts it, and never lets stale cleanup disconnect its replacement", async () => {
    const firstConnect = deferred<void>();
    let first = true;
    vi.mocked(invoke).mockImplementation((command) => {
      if (command === "server_connect" && first) { first = false; return firstConnect.promise; }
      return Promise.resolve(undefined);
    });
    const controller = new AbortController();
    const oldChanged = vi.fn();
    const oldSetup = onChange(oldChanged, { signal: controller.signal });
    await settle();
    const oldId = id();
    controller.abort();
    const changed = vi.fn();
    const replacement = onChange(changed);
    await settle();
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_connect")).toHaveLength(1);
    firstConnect.resolve();
    const oldCleanup = await oldSetup;
    const cleanup = await replacement;
    const newId = id();
    oldCleanup();
    callbacks[0]({ payload: { connectionId: oldId, kind: "tasks" } });
    callbacks[1]({ payload: { connectionId: oldId, kind: "tasks" } });
    callbacks[1]({ payload: { connectionId: newId, kind: "note" } });
    expect(oldChanged).not.toHaveBeenCalled();
    expect(changed.mock.calls).toEqual([["note"]]);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_disconnect"))
      .toEqual([["server_disconnect", { connectionId: oldId }]]);
    cleanup();
    await settle();
  });

  it("does not start an old delayed setup after a newer subscription", async () => {
    const listener = deferred<() => void>();
    const remove = vi.fn();
    vi.mocked(listen).mockReturnValueOnce(listener.promise);
    const old = onChange(vi.fn());
    const cleanup = await onChange(vi.fn());
    listener.resolve(remove);
    await old;
    expect(remove).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_connect")).toHaveLength(1);
    cleanup();
    await settle();
  });

  it("cleans failed setup without poisoning the next connection", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("command failure"));
    await expect(onChange(vi.fn())).rejects.toThrow("command failure");
    await settle();
    expect(removers[0]).toHaveBeenCalledTimes(1);
    const cleanup = await onChange(vi.fn());
    cleanup();
    await settle();
  });

  it("changes to local delivery only after owned teardown and ignores old server events", async () => {
    const changed = vi.fn();
    await onChange(changed);
    const oldId = id();
    localStorage.removeItem("ntr.serverUrl");
    activateTransport();
    const local = vi.fn();
    const cleanup = await onChange(local);
    const lastCall = vi.mocked(listen).mock.calls[vi.mocked(listen).mock.calls.length - 1];
    expect(lastCall[0]).toBe("change");
    expect(invoke).toHaveBeenCalledWith("server_disconnect", { connectionId: oldId });
    callbacks[0]({ payload: { connectionId: oldId, kind: "note" } });
    const localCallback = lastCall[1] as (event: { payload: string }) => void;
    localCallback({ payload: "tasks" });
    expect(changed).not.toHaveBeenCalled();
    expect(local).toHaveBeenCalledWith("tasks");
    cleanup();
    await settle();
  });

  it("rejects callbacks when certificate settings change before React effects run", async () => {
    const changed = vi.fn();
    const cleanup = await onChange(changed);
    localStorage.setItem("ntr.allowInvalidCert", "1");
    callbacks[0]({ payload: { connectionId: id(), kind: "note" } });
    expect(changed).not.toHaveBeenCalled();
    cleanup();
    await settle();
  });
});

describe("transport-bound deferred work", () => {
  it("cancels startup reconciliation before its delayed read can issue a write", async () => {
    localStorage.setItem("ntr.conflictStrategy", "local");
    const read = deferred<ReturnType<typeof httpResp>>();
    vi.mocked(invoke).mockImplementation((command) => command === "server_fetch" ? read.promise : Promise.resolve("draft"));
    const controller = new AbortController();
    const work = reconcileWithServer(captureTransport(), controller.signal);
    controller.abort();
    read.resolve(httpResp("remote"));
    expect(await work).toEqual([]);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_fetch")).toHaveLength(1);
    expect(reqOf(0).method).toBe("GET");
  });

  it("does not back up an old note save after a target switch", async () => {
    const write = deferred<ReturnType<typeof httpResp>>();
    vi.mocked(invoke).mockReturnValueOnce(write.promise);
    const owner = captureTransport();
    const save = putNote("A's draft", owner);
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    write.resolve(httpResp(null, 204));
    await save;
    expect(reqOf(0).url).toBe(`${SERVER}/api/note`);
    expect(vi.mocked(invoke).mock.calls).toHaveLength(1);
    expect(() => getNote(owner)).toThrow("Connection changed");
    await expect(putLabels({ project: ["A"], context: [] }, owner)).rejects.toThrow("Connection changed");
  });

  it("invalidates local contexts even when the URL stays empty", () => {
    localStorage.removeItem("ntr.serverUrl");
    const owner = captureTransport();
    activateTransport();
    expect(() => getNote(owner)).toThrow("Connection changed");
  });

  it("does not apply stale startup reconciliation to the next server", async () => {
    localStorage.setItem("ntr.conflictStrategy", "local");
    const read = deferred<ReturnType<typeof httpResp>>();
    vi.mocked(invoke).mockImplementation((command) => command === "server_fetch" ? read.promise : Promise.resolve("A"));
    const reconcile = reconcileWithServer();
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    read.resolve(httpResp("remote A"));
    expect(await reconcile).toEqual([]);
    expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_fetch")).toHaveLength(1);
    expect(reqOf(0).method).toBe("GET");
  });

  it("rejects a stale startup conflict choice instead of targeting current settings", async () => {
    mockServer([["remote A"], ["raw A"]], { note: "local A", raw: "raw A" });
    const [conflict] = await reconcileWithServer();
    vi.mocked(invoke).mockClear();
    localStorage.setItem("ntr.serverUrl", "http://server-b");
    activateTransport();
    await expect(resolveConflict(conflict, "local")).rejects.toThrow("Connection changed");
    expect(invoke).not.toHaveBeenCalled();
  });
});

// --- Server mode — local backup ---
// Each mutating function must also persist data locally via Tauri invoke after the server
// write succeeds. Failures in the local backup must not propagate.

describe("server mode — local backup", () => {
  // Second server response in each mockServer call is the task backup's GET /api/raw —
  // the server store's todo.txt render returned verbatim as text.

  it("putNote calls invoke put_note with the same text after the server write", async () => {
    mockServer([[null, 204]]);
    await putNote("hello backup");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "hello backup" });
  });

  it("createTask calls invoke put_raw with the server's raw todo.txt after the write", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await createTask("buy milk");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("createTask backup request uses exact /api/raw URL with no query string", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await createTask("x");
    const backupUrl = reqOf(1).url;
    expect(backupUrl).toBe(`${SERVER}/api/raw`);
    expect(backupUrl).not.toContain("?");
  });

  it("updateTask calls invoke put_raw after the server write", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await updateTask(1, "updated");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("completeTask calls invoke put_raw after the server write", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await completeTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("uncompleteTask calls invoke put_raw after the server write", async () => {
    mockServer([[TASK], [TASK.raw + "\n"]]);
    await uncompleteTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("deleteTask calls invoke put_raw after the server write", async () => {
    mockServer([[null, 204], [TASK.raw + "\n"]]);
    await deleteTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("local task backup failure does not reject the primary promise", async () => {
    // server_fetch succeeds; the put_raw backup throws.
    let n = 0;
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "server_fetch") return Promise.resolve(httpResp(n++ === 0 ? TASK : TASK.raw + "\n"));
      if (cmd === "put_raw") return Promise.reject(new Error("disk full"));
      return Promise.resolve(undefined);
    });
    const result = await createTask("x");
    expect(result).toEqual(TASK);
  });

  it("local note backup failure does not reject the primary promise", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "server_fetch") return Promise.resolve(httpResp(null, 204));
      if (cmd === "put_note") return Promise.reject(new Error("disk full"));
      return Promise.resolve(undefined);
    });
    await expect(putNote("x")).resolves.toBeUndefined();
  });

  it("backup writes an empty string when the server task file is empty", async () => {
    mockServer([[TASK], [""]]);
    await createTask("x");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: "" });
  });
});

// --- reconcileWithServer + resolveConflict ---
// reconcile reads the local copy (get_note / get_raw) and the server copy
// (GET /api/note then GET /api/raw, in that order), classifies the divergence,
// and either auto-applies it or returns it for the UI to prompt.

describe("reconcileWithServer", () => {
  it("is a no-op in local mode (returns [], no server_fetch)", async () => {
    localStorage.removeItem("ntr.serverUrl");
    mockServer();
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("server_fetch", expect.anything());
  });

  it("returns no conflicts and writes nothing when both copies match", async () => {
    mockServer([["same note"], ["same raw"]], { note: "same note", raw: "same raw" });
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_raw", expect.anything());
  });

  it("adopts the server copy silently when the local copy is empty", async () => {
    mockServer([["server hello"], [""]], { note: "", raw: "" }); // note differs (local empty), tasks in-sync
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "server hello" });
  });

  it("returns a conflict (and writes nothing) under the default 'ask' strategy", async () => {
    mockServer([["server note"], [""]], { note: "local note", raw: "" });
    expect(await reconcileWithServer()).toEqual([
      { resource: "note", local: "local note", server: "server note" },
    ]);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
  });

  it("auto-applies the server copy when the strategy is 'server'", async () => {
    localStorage.setItem("ntr.conflictStrategy", "server");
    mockServer([["server note"], [""]], { note: "local note", raw: "" });
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "server note" });
  });

  it("auto-pushes the local copy to the server when the strategy is 'local'", async () => {
    localStorage.setItem("ntr.conflictStrategy", "local");
    // GET /api/note, then PUT /api/note (push), then GET /api/raw (in-sync).
    mockServer([["server note"], [null, 204], [""]], { note: "local note", raw: "" });
    expect(await reconcileWithServer()).toEqual([]);
    expect(reqOf(1)).toMatchObject({ url: `${SERVER}/api/note`, method: "PUT", body: "local note" });
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
  });

  it("isolates a per-resource failure: a failed note read still yields the task conflict", async () => {
    // note GET 404 (rejects inside the note iteration), tasks GET ok and differs.
    mockServer([[null, 404], ["server raw"]], { note: "local note", raw: "local raw" });
    expect(await reconcileWithServer()).toEqual([
      { resource: "tasks", local: "local raw", server: "server raw" },
    ]);
  });
});

describe("resolveConflict", () => {
  it("'server' writes the server copy to the local file", async () => {
    mockServer();
    await resolveConflict({ resource: "tasks", local: "L", server: "S" }, "server");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: "S" });
  });

  it("'local' pushes the local copy to the server", async () => {
    mockServer([[null, 204]]);
    await resolveConflict({ resource: "tasks", local: "L", server: "S" }, "local");
    expect(reqOf(0)).toMatchObject({ url: `${SERVER}/api/raw`, method: "PUT", body: "L" });
  });
});
