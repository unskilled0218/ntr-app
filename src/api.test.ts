import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import {
  completeTask,
  createTask,
  deleteTask,
  errMsg,
  getNote,
  listTasks,
  onChange,
  putNote,
  reconcileWithServer,
  resolveConflict,
  uncompleteTask,
  updateTask,
} from "./api";

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

function mkRes(body: unknown, status = 200): Response {
  const bodyInit =
    body === null
      ? null
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  return new Response(bodyInit, { status });
}

function makeFetch(body: unknown, status = 200): ReturnType<typeof vi.fn> {
  // 204/205 must have a null body; other statuses serialise the payload.
  const bodyInit = body === null || status === 204 || status === 205
    ? null
    : typeof body === "string" ? body : JSON.stringify(body);
  const res = new Response(bodyInit, { status });
  const mock = vi.fn().mockResolvedValue(res);
  vi.stubGlobal("fetch", mock);
  return mock;
}

// Creates fresh Response objects for successive fetch calls (avoids "body already read" errors).
// Each spec is [body, status?]; to pass an array as the body wrap it: [[item1, item2]].
function makeFetchSeq(...specs: Array<[body: unknown, status?: number]>): ReturnType<typeof vi.fn> {
  const mock = vi.fn();
  specs.forEach(([body, status]) => mock.mockResolvedValueOnce(mkRes(body, status)));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  localStorage.setItem("ntr.serverUrl", SERVER);
});

afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("listTasks (server mode)", () => {
  it("calls GET /api/tasks with no params when filter is empty", async () => {
    const mock = makeFetch([TASK]);
    const result = await listTasks({});
    expect(result).toEqual([TASK]);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks`, undefined);
  });

  it("appends only non-null filter params", async () => {
    const mock = makeFetch([]);
    await listTasks({ completed: false, project: "work", context: null, priority: null });
    const url = (mock.mock.calls[0] as [string])[0];
    expect(url).toContain("completed=false");
    expect(url).toContain("project=work");
    expect(url).not.toContain("context=");
    expect(url).not.toContain("priority=");
  });
});

describe("createTask (server mode)", () => {
  it("calls POST /api/tasks with JSON body", async () => {
    const mock = makeFetch(TASK);
    const result = await createTask("buy milk");
    expect(result).toEqual(TASK);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks`, expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ text: "buy milk" }),
    }));
  });
});

describe("updateTask (server mode)", () => {
  it("calls PUT /api/tasks/{id} with JSON body", async () => {
    const mock = makeFetch(TASK);
    await updateTask(1, "updated");
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks/1`, expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({ text: "updated" }),
    }));
  });
});

describe("completeTask (server mode)", () => {
  it("calls POST /api/tasks/{id}/complete", async () => {
    const mock = makeFetch(TASK);
    await completeTask(1);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks/1/complete`, expect.objectContaining({ method: "POST" }));
  });
});

describe("uncompleteTask (server mode)", () => {
  it("calls POST /api/tasks/{id}/uncomplete", async () => {
    const mock = makeFetch(TASK);
    await uncompleteTask(1);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks/1/uncomplete`, expect.objectContaining({ method: "POST" }));
  });
});

describe("deleteTask (server mode)", () => {
  it("calls DELETE /api/tasks/{id}", async () => {
    const mock = makeFetch(null, 204);
    await deleteTask(1);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/tasks/1`, expect.objectContaining({ method: "DELETE" }));
  });
});

describe("getNote (server mode)", () => {
  it("calls GET /api/note and returns text", async () => {
    const mock = makeFetch("hello note");
    const result = await getNote();
    expect(result).toBe("hello note");
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/note`, undefined);
  });
});

describe("putNote (server mode)", () => {
  it("calls PUT /api/note with plain-text body and Content-Type header", async () => {
    const mock = makeFetch(null, 204);
    await putNote("my note text");
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/note`, expect.objectContaining({
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: "my note text",
    }));
  });
});

describe("onChange (server mode)", () => {
  class MockEventSource {
    url: string;
    private handlers = new Map<string, Array<(e: Event) => void>>();
    closed = false;
    constructor(url: string) { this.url = url; }
    addEventListener(type: string, handler: (e: Event) => void) {
      this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
    }
    close() { this.closed = true; }
    emit(type: string, data: string) {
      const e = new MessageEvent(type, { data });
      (this.handlers.get(type) ?? []).forEach((h) => h(e));
    }
  }

  it("creates EventSource at the correct URL and fires handler on 'change' event", async () => {
    let instance!: MockEventSource;
    vi.stubGlobal("EventSource", class extends MockEventSource {
      constructor(url: string) { super(url); instance = this; }
    });

    const received: string[] = [];
    const unlisten = await onChange((kind) => received.push(kind));

    expect(instance.url).toBe(`${SERVER}/api/events`);
    instance.emit("change", "tasks");
    instance.emit("change", "note");
    expect(received).toEqual(["tasks", "note"]);

    unlisten();
    expect(instance.closed).toBe(true);
  });
});

describe("HTTP error mapping", () => {
  it("throws a message containing the status code on a non-2xx response", async () => {
    makeFetch(null, 404);
    await expect(listTasks({})).rejects.toThrow("404");
  });

  it("errMsg extracts the message from the thrown Error", async () => {
    makeFetch(null, 500);
    const err = await listTasks({}).catch((e: unknown) => e);
    expect(errMsg(err)).toContain("500");
  });
});

// --- Server mode — local backup ---
// Each mutating function must also persist data locally via Tauri invoke after
// the server write succeeds. Failures in the local backup must not propagate.

describe("server mode — local backup", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  // Second spec in each makeFetchSeq call is the task backup's GET /api/raw response —
  // the server store's todo.txt render returned verbatim as text.

  it("putNote calls invoke put_note with the same text after the server write", async () => {
    makeFetchSeq([null, 204]);
    await putNote("hello backup");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "hello backup" });
  });

  it("createTask calls invoke put_raw with the server's raw todo.txt after the write", async () => {
    makeFetchSeq([TASK], [TASK.raw + "\n"]);
    await createTask("buy milk");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("createTask backup fetch uses exact /api/raw URL with no query string", async () => {
    const mock = makeFetchSeq([TASK], [TASK.raw + "\n"]);
    await createTask("x");
    const backupUrl = (mock.mock.calls[1] as [string])[0];
    expect(backupUrl).toBe(`${SERVER}/api/raw`);
    expect(backupUrl).not.toContain("?");
  });

  it("updateTask calls invoke put_raw after the server write", async () => {
    makeFetchSeq([TASK], [TASK.raw + "\n"]);
    await updateTask(1, "updated");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("completeTask calls invoke put_raw after the server write", async () => {
    makeFetchSeq([TASK], [TASK.raw + "\n"]);
    await completeTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("uncompleteTask calls invoke put_raw after the server write", async () => {
    makeFetchSeq([TASK], [TASK.raw + "\n"]);
    await uncompleteTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("deleteTask calls invoke put_raw after the server write", async () => {
    makeFetchSeq([null, 204], [TASK.raw + "\n"]);
    await deleteTask(1);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: TASK.raw + "\n" });
  });

  it("local task backup failure does not reject the primary promise", async () => {
    makeFetchSeq([TASK], [TASK.raw + "\n"]);
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    const result = await createTask("x");
    expect(result).toEqual(TASK);
  });

  it("local note backup failure does not reject the primary promise", async () => {
    makeFetchSeq([null, 204]);
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    await expect(putNote("x")).resolves.toBeUndefined();
  });

  it("backup writes an empty string when the server task file is empty", async () => {
    makeFetchSeq([TASK], [""]);
    await createTask("x");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: "" });
  });
});

// --- reconcileWithServer + resolveConflict ---
// reconcile reads the local copy (get_note / get_raw) and the server copy
// (GET /api/note then GET /api/raw, in that order), classifies the divergence,
// and either auto-applies it or returns it for the UI to prompt.

describe("reconcileWithServer", () => {
  // Dispatch local reads by command name; writes (put_note/put_raw) resolve to undefined.
  function mockLocal({ note = "", raw = "" }: { note?: string; raw?: string }) {
    vi.mocked(invoke).mockImplementation((cmd: string) => {
      if (cmd === "get_note") return Promise.resolve(note);
      if (cmd === "get_raw") return Promise.resolve(raw);
      return Promise.resolve(undefined);
    });
  }

  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("is a no-op in local mode (returns [], no fetch calls)", async () => {
    localStorage.removeItem("ntr.serverUrl");
    const mock = vi.fn();
    vi.stubGlobal("fetch", mock);
    expect(await reconcileWithServer()).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns no conflicts and writes nothing when both copies match", async () => {
    mockLocal({ note: "same note", raw: "same raw" });
    makeFetchSeq(["same note"], ["same raw"]);
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_raw", expect.anything());
  });

  it("adopts the server copy silently when the local copy is empty", async () => {
    mockLocal({ note: "", raw: "" });
    makeFetchSeq(["server hello"], [""]); // note differs (local empty), tasks in-sync
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "server hello" });
  });

  it("returns a conflict (and writes nothing) under the default 'ask' strategy", async () => {
    mockLocal({ note: "local note", raw: "" });
    makeFetchSeq(["server note"], [""]);
    expect(await reconcileWithServer()).toEqual([
      { resource: "note", local: "local note", server: "server note" },
    ]);
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
  });

  it("auto-applies the server copy when the strategy is 'server'", async () => {
    localStorage.setItem("ntr.conflictStrategy", "server");
    mockLocal({ note: "local note", raw: "" });
    makeFetchSeq(["server note"], [""]);
    expect(await reconcileWithServer()).toEqual([]);
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_note", { text: "server note" });
  });

  it("auto-pushes the local copy to the server when the strategy is 'local'", async () => {
    localStorage.setItem("ntr.conflictStrategy", "local");
    mockLocal({ note: "local note", raw: "" });
    // GET /api/note, then PUT /api/note (push), then GET /api/raw (in-sync).
    const mock = makeFetchSeq(["server note"], [null, 204], [""]);
    expect(await reconcileWithServer()).toEqual([]);
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/note`, expect.objectContaining({
      method: "PUT",
      body: "local note",
    }));
    expect(vi.mocked(invoke)).not.toHaveBeenCalledWith("put_note", expect.anything());
  });

  it("isolates a per-resource failure: a failed note read still yields the task conflict", async () => {
    mockLocal({ note: "local note", raw: "local raw" });
    makeFetchSeq([null, 404], ["server raw"]); // note GET 404, tasks GET ok and differs
    expect(await reconcileWithServer()).toEqual([
      { resource: "tasks", local: "local raw", server: "server raw" },
    ]);
  });
});

describe("resolveConflict", () => {
  afterEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("'server' writes the server copy to the local file", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await resolveConflict({ resource: "tasks", local: "L", server: "S" }, "server");
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("put_raw", { text: "S" });
  });

  it("'local' pushes the local copy to the server", async () => {
    const mock = makeFetch(null, 204);
    await resolveConflict({ resource: "tasks", local: "L", server: "S" }, "local");
    expect(mock).toHaveBeenCalledWith(`${SERVER}/api/raw`, expect.objectContaining({
      method: "PUT",
      body: "L",
    }));
  });
});
