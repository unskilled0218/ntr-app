import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

it("detects missed changes after reconnect, retries failures, and keeps both panes unchanged until approval", async () => {
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
    if ((args as { req: { url: string } }).req.url.endsWith("/api/capabilities")) return { ok: false, status: 404, status_text: "Not Found", body: "" };
    const { req } = args as { req: { url: string } };
    let body: string;
    const path = new URL(req.url).pathname;
    if (path === "/api/tasks") {
      if (failTasks) {
        failTasks = false;
        return { ok: false, status: 503, status_text: "Unavailable", body: "" };
      }
      const task: Task = {
        id: 1, completed: false, completion_date: null, creation_date: null,
        description: taskText, lists: [], contexts: [], tags: {}, raw: taskText,
      };
      body = JSON.stringify([task]);
    } else if (path === "/api/note") body = note;
    else if (path === "/api/raw") body = taskText + "\n";
    else body = JSON.stringify({ list: [], context: [] });
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
  expect(container.querySelector(".remote-updates")!.textContent).toContain("Unavailable");
  expect(container.querySelector("#note-input")!.textContent).toBe("base");
  await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
  expect(container.querySelector("#tasks")!.textContent).toContain("start task");
  expect(container.querySelector(".remote-updates")!.textContent).not.toContain("Unavailable");
  const dialog = within(container.querySelector("#remote-update") as HTMLElement);
  fireEvent.click(dialog.getByRole("button", { name: "Not now" }));
  fireEvent.click(dialog.getByRole("button", { name: "Not now" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review update for tasks" })); await settle(); });
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Update" })); await settle(); });
  expect(container.querySelector("#tasks")!.textContent).toContain("missed task");
  expect(container.querySelector("#note-input")!.textContent).toBe("base");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review update for note" })); await settle(); });
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: "Update" })); await settle(); });
  expect(container.querySelector("#note-input")!.textContent).toBe("missed note");
  const reads = vi.mocked(invoke).mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(60000); });
  expect(invoke).toHaveBeenCalledTimes(reads);
});
