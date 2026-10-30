import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import { StrictMode } from "react";
import { setEditorText } from "./lib/caret";
import { canMutate, getLabels, getNote, usingLocalFallback, type Task } from "./api";
import { deferred, settle } from "./test/deferred";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const unavailable = { kind: "connection", message: "error sending request for url (server-url)" };
const task = (description: string): Task => ({ id: 1, description, raw: description, projects: ["local-project"], contexts: [], tags: {}, completed: false, completion_date: null, creation_date: null });
let offline: boolean;
let localNote: string;
let localTasks: Task[];
let remoteNote: string;
let remoteTasks: Task[];
let listeners: Map<string, (event: { payload: unknown }) => void>;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ntr.serverUrl", "http://saved-server");
  localNote = "local note"; remoteNote = localNote;
  localTasks = [task("local task")]; remoteTasks = [task("server task")];
  offline = true;
  listeners = new Map();
  vi.mocked(listen).mockImplementation(async (name, handler) => {
    listeners.set(name, handler as (event: { payload: unknown }) => void);
    return () => { listeners.delete(name); };
  });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "get_note") return localNote;
    if (command === "get_raw") return localTasks.map((found) => found.raw).join("\n");
    if (command === "list_tasks") return structuredClone(localTasks);
    if (command === "get_labels") return { project: ["local-project"], context: [] };
    if (command === "put_note") { localNote = (args as { text: string }).text; return; }
    if (command === "put_labels") return;
    if (command === "put_raw") return;
    if (command === "create_task") { const found = task((args as { text: string }).text); localTasks.push(found); return found; }
    if (command === "complete_task") { localTasks[0].completed = true; return structuredClone(localTasks[0]); }
    if (command === "get_data_dir") return "/local";
    if (command === "storage_kind") return "path";
    if (command === "server_fetch") {
      if (offline) throw unavailable;
      const req = (args as { req: { url: string; method: string } }).req;
      const path = new URL(req.url).pathname;
      const body = path === "/api/note" ? remoteNote : path === "/api/raw" ? remoteTasks.map((found) => found.raw).join("\n") : path === "/api/tasks" ? JSON.stringify(remoteTasks) : JSON.stringify({ project: ["server-project"], context: [] });
      return { ok: true, status: 200, status_text: "OK", body };
    }
  });
});
afterEach(async () => { cleanup(); await settle(); vi.useRealTimers(); localStorage.clear(); vi.restoreAllMocks(); });

async function open() {
  const view = render(<App />);
  await act(settle);
  return view;
}
async function connect() {
  fireEvent.click(screen.getAllByRole("button", { name: "Connection settings" })[0]);
  await act(settle);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Connect" })); await settle(); });
}

it.each(["ask", "server", "local"])("shows local tasks, note, labels, and mode instead of the label-only error (%s)", async (strategy) => {
  localStorage.setItem("ntr.conflictStrategy", strategy);
  const { container } = await open();
  expect(container.querySelector("#tasks")!.textContent).toContain("local task");
  expect(container.querySelector("#note-input")!.textContent).toBe("local note");
  expect(container.querySelector("#error")!.textContent).toBe("");
  expect(screen.getByText("Server unavailable; using local files")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Connection settings" })[0].textContent).toBe("[L]");
  expect(localStorage.getItem("ntr.serverUrl")).toBe("http://saved-server");
  expect(canMutate("tasks")).toBe(true);
  expect(canMutate("note")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
  expect(screen.getByRole("button", { name: "local-project" })).toBeTruthy();
});

it("loads empty local files as normal empty states", async () => {
  localNote = ""; localTasks = [];
  const { container } = await open();
  expect(container.querySelector("#note-input")!.textContent).toBe("");
  expect(container.querySelector("#tasks")!.children).toHaveLength(0);
  expect(screen.getByText("No tasks.")).toBeTruthy();
  expect(canMutate("tasks")).toBe(true);
});

it("can leave fallback for deliberate local mode without losing local readiness", async () => {
  await open();
  fireEvent.click(screen.getAllByRole("button", { name: "Connection settings" })[0]);
  await act(settle);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use local files" })); await settle(); });
  expect(localStorage.getItem("ntr.serverUrl")).toBeNull();
  expect(usingLocalFallback()).toBe(false);
  expect(canMutate("tasks")).toBe(true);
  expect(screen.queryByText("Server unavailable; using local files")).toBeNull();
});

it("keeps genuine local read errors visible without enabling that resource", async () => {
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args) => name === "get_labels" ? Promise.reject("local permission denied") : original(name, args));
  const { container } = await open();
  expect(container.querySelector("#tasks")!.textContent).toContain("local task");
  expect(container.querySelector("#error")!.textContent).toContain("local permission denied");
  expect(canMutate("tasks")).toBe(false);
  expect(canMutate("note")).toBe(true);
});

it("uses local mutations and local watcher events while fallback stays active", async () => {
  const { container } = await open();
  await act(async () => { fireEvent.click(screen.getByRole("checkbox")); await settle(); });
  expect(localTasks[0].completed).toBe(true);
  localNote = "external local change";
  localTasks = [task("external local task")];
  await act(async () => { listeners.get("change")!({ payload: "note" }); listeners.get("change")!({ payload: "tasks" }); await settle(); });
  expect(container.querySelector("#note-input")!.textContent).toBe("external local change");
  expect(container.querySelector("#tasks")!.textContent).toContain("external local task");
  expect(usingLocalFallback()).toBe(true);
});

it("does not retry when unchanged settings close, and explicit same-URL Connect can fail repeatedly", async () => {
  await open();
  const count = vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_fetch").length;
  fireEvent.click(screen.getAllByRole("button", { name: "Connection settings" })[0]);
  await act(settle);
  const dialog = screen.getByRole("dialog", { name: "", hidden: false });
  fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
  await act(settle);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "server_fetch")).toHaveLength(count);
  await connect();
  expect(usingLocalFallback()).toBe(true);
  expect(canMutate("tasks")).toBe(true);
  expect(screen.getByText("Server unavailable; using local files")).toBeTruthy();
});

it("reconnects explicitly, keeps panes mounted, and waits for discovery before enabling actions", async () => {
  const { container } = await open();
  const editor = container.querySelector("#note-input")!;
  const discovery = deferred<unknown>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  offline = false;
  // Keep copies equal so this test isolates transition readiness, not choices.
  remoteTasks = structuredClone(localTasks);
  vi.mocked(invoke).mockImplementation((name, args) => {
    if (name === "server_fetch" && (args as { req: { url: string } }).req.url.endsWith("/api/note")) return discovery.promise;
    return original(name, args);
  });
  await connect();
  expect(canMutate("tasks")).toBe(false);
  expect(canMutate("note")).toBe(false);
  expect((container.querySelector("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect(container.querySelector("#note-input")).toBe(editor);
  await act(async () => { discovery.resolve({ ok: true, status: 200, body: localNote }); await settle(); });
  expect(canMutate("tasks")).toBe(true);
  expect(canMutate("note")).toBe(true);
  expect(screen.getAllByRole("button", { name: "Connection settings" })[0].textContent).toBe("[S]");
});

it("retains a dirty server draft during labels-only failure and requires a local save choice", async () => {
  vi.useFakeTimers();
  offline = false;
  remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  const editor = container.querySelector("#note-input") as HTMLElement;
  setEditorText(editor as HTMLDivElement, "unsaved server draft", 20);
  fireEvent.input(editor);
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  expect(container.querySelector("#note-input")).toBe(editor);
  expect(editor.textContent).toBe("unsaved server draft");
  expect(localNote).toBe("local note");
  fireEvent.blur(editor);
  window.dispatchEvent(new Event("pagehide"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(localNote).toBe("local note");
  const dialog = within(container.querySelector("#note-conflict") as HTMLElement);
  await act(async () => { fireEvent.click(dialog.getByRole("button", { name: /Keep mine/ })); await settle(); });
  expect(localNote).toBe("unsaved server draft");
});

it("initializes and falls back under the application's StrictMode lifecycle", async () => {
  const { container } = render(<StrictMode><App /></StrictMode>);
  await act(settle);
  expect(container.querySelector("#note-input")!.textContent).toBe("local note");
  expect(canMutate("tasks")).toBe(true);
});

it("retains an edit draft but never applies its old server ID to the local task with the same ID", async () => {
  offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const input = screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "server edit draft" } });
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  expect(input.value).toBe("server edit draft");
  const modal = container.querySelector("#edit-task-modal") as HTMLElement;
  await act(async () => { fireEvent.submit(modal.querySelector("form")!); await settle(); });
  expect(localTasks[0].description).toBe("local task");
  expect(modal.textContent).toContain("destination changed");
  expect(vi.mocked(invoke).mock.calls.some(([name]) => name === "update_task")).toBe(false);
});

it("does not save transferred drafts when their destination choice is dismissed", async () => {
  vi.useFakeTimers(); offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  const editor = container.querySelector("#note-input") as HTMLDivElement;
  setEditorText(editor, "retained draft", 14); fireEvent.input(editor);
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  const dialog = container.querySelector("#note-conflict") as HTMLDialogElement;
  await act(async () => { dialog.close(); await settle(); });
  fireEvent.blur(editor); window.dispatchEvent(new Event("pagehide"));
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(localNote).toBe("local note");
  expect(editor.textContent).toBe("retained draft");
  expect(screen.getByRole("button", { name: "Review destination note" })).toBeTruthy();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Review destination note" })); await settle(); });
  expect(dialog.open).toBe(true);
});

it("defers note loading through IME fallback and protects the committed draft", async () => {
  vi.useFakeTimers(); offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  const editor = container.querySelector("#note-input") as HTMLDivElement;
  fireEvent.compositionStart(editor);
  setEditorText(editor, "IME preedit", 11); fireEvent.input(editor);
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  expect(canMutate("note")).toBe(false);
  expect(canMutate("tasks")).toBe(true);
  setEditorText(editor, "IME committed", 13);
  await act(async () => { fireEvent.compositionEnd(editor); await settle(); });
  fireEvent.blur(editor);
  await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
  expect(localNote).toBe("local note");
  expect(editor.textContent).toBe("IME committed");
  expect((container.querySelector("#note-conflict") as HTMLDialogElement).open).toBe(true);
});

it("does not clear an add draft when its old server request finishes after fallback", async () => {
  offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  const input = screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: "pending create draft" } });
  const write = deferred<unknown>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation((name, args) => {
    if (name === "server_fetch" && (args as { req: { method: string } }).req.method === "POST") return write.promise;
    return original(name, args);
  });
  await act(async () => { fireEvent.submit(container.querySelector("#add-form")!); await settle(); });
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  expect(canMutate("tasks")).toBe(true);
  await act(async () => { write.resolve({ ok: true, status: 200, body: JSON.stringify(task("accepted old create")) }); await settle(); });
  expect(input.value).toBe("pending create draft");
  expect(localTasks).toHaveLength(1);
  expect(container.querySelector("#tasks")!.textContent).not.toContain("accepted old create");
});

it("keeps task dialog cancellation and settings available while native storage is waiting", async () => {
  offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  const commit = deferred<void>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === "put_labels") await commit.promise;
    return original(name, args);
  });
  const { putLabels } = await import("./api");
  const save = putLabels({ project: ["pending backup"], context: [] });
  await act(settle);
  await act(async () => { offline = true; await getLabels().catch(() => {}); await settle(); });
  expect((screen.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
  const cancel = screen.getByRole("button", { name: "Cancel" }) as HTMLButtonElement;
  expect(cancel.disabled).toBe(false);
  fireEvent.click(cancel);
  fireEvent.click(screen.getAllByRole("button", { name: "Connection settings" })[0]);
  await act(settle);
  expect((container.querySelector("#settings-modal") as HTMLDialogElement).open).toBe(true);
  expect(screen.getByText("Waiting for local storage")).toBeTruthy();
  await act(async () => { commit.resolve(); await save; await settle(); });
});

it("waits for an in-flight local backup before loading fallback without losing mounted content", async () => {
  offline = false; remoteTasks = structuredClone(localTasks);
  const { container } = await open();
  const editor = container.querySelector("#note-input") as HTMLElement;
  const commit = deferred<void>();
  const original = vi.mocked(invoke).getMockImplementation()!;
  vi.mocked(invoke).mockImplementation(async (name, args) => {
    if (name === "put_labels") await commit.promise;
    return original(name, args);
  });
  const { putLabels } = await import("./api");
  const save = putLabels({ project: ["backup"], context: [] });
  await act(settle);
  await act(async () => { offline = true; await getNote().catch(() => {}); await settle(); });
  expect(screen.getByText("Waiting for local storage")).toBeTruthy();
  expect(container.querySelector("#note-input")).toBe(editor);
  expect(canMutate("tasks")).toBe(false);
  await act(async () => { commit.resolve(); await save; await settle(); });
  expect(canMutate("tasks")).toBe(true);
  expect(screen.getByText("Server unavailable; using local files")).toBeTruthy();
});
