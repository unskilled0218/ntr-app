import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeTask,
  createTask,
  deleteTask,
  errMsg,
  getNote,
  listTasks,
  onChange,
  putNote,
  uncompleteTask,
  updateTask,
} from "./api";

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
