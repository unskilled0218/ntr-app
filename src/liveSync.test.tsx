import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import type { Task } from "./api";
import { settle } from "./test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

afterEach(async () => {
  cleanup();
  await settle();
  vi.useRealTimers();
  localStorage.clear();
});

it("recovers both real panes after connected even when one GET fails and no further event arrives", async () => {
  vi.useFakeTimers();
  localStorage.setItem("ntr.serverUrl", "http://shared-server");
  let taskText = "start task";
  let note = "base";
  let failTasks = false;
  let connectionId = "";
  let event!: (event: { payload: { connectionId: string; kind: string } }) => void;
  vi.mocked(listen).mockImplementation((_name, handler) => {
    event = handler as typeof event;
    return Promise.resolve(vi.fn());
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "server_connect") {
      connectionId = (args as { connectionId: string }).connectionId;
      return;
    }
    if (command === "get_note") return "base";
    if (command === "get_raw") return "start task\n";
    if (command !== "server_fetch") return;
    const { req } = args as { req: { url: string } };
    let body: string;
    const path = new URL(req.url).pathname;
    if (path === "/api/tasks") {
      if (failTasks) {
        failTasks = false;
        return { ok: false, status: 503, status_text: "Unavailable", body: "" };
      }
      const task: Task = {
        id: 1, completed: false, priority: null, completion_date: null, creation_date: null,
        description: taskText, projects: [], contexts: [], tags: {}, raw: taskText,
      };
      body = JSON.stringify([task]);
    } else if (path === "/api/note") body = note;
    else if (path === "/api/raw") body = taskText + "\n";
    else body = JSON.stringify({ project: [], context: [] });
    return { ok: true, status: 200, status_text: "OK", body };
  });
  const { container } = render(<App />);
  await act(settle);
  expect(container.querySelector("#tasks")!.textContent).toContain("start task");
  expect(container.querySelector("#note-input")!.textContent).toBe("base");

  taskText = "missed task";
  note = "missed note";
  failTasks = true;
  await act(async () => {
    event({ payload: { connectionId, kind: "connected" } });
    await settle();
  });
  expect(container.querySelector("#tasks")!.textContent).toContain("start task");
  expect(container.querySelector("#error")!.textContent).toContain("Unavailable");
  expect(container.querySelector("#note-input")!.textContent).toBe("missed note");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector("#tasks")!.textContent).toContain("missed task");
  expect(container.querySelector("#error")!.textContent).toBe("");
  const reads = vi.mocked(invoke).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(invoke).toHaveBeenCalledTimes(reads);
});
