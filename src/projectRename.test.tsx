import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import TodoPane, { type TodoPaneHandle } from "./components/TodoPane";
import { activateTransport, type Labels, type Task } from "./api";
import { deferred, settle } from "./test/deferred";
import { setEditorText } from "./lib/caret";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
function task(id: number, raw: string): Task {
  const completed = raw.startsWith("x ");
  const description = completed ? raw.slice(2) : raw;
  return { id, raw, completed, description, completion_date: null, creation_date: null,
    projects: [...new Set(description.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1)))], contexts: [], tags: {} };
}
function fixture(server = true) {
  localStorage.setItem("ntr.serverUrl", server ? "http://shared" : ""); activateTransport();
  const data = { tasks: [task(1, "first +old"), task(2, "x second +old")], labels: { project: ["old", "other"], context: ["phone"] } as Labels, note: "base" };
  let connectionId = "";
  let signal!: (event: { payload: { connectionId: string; kind: string } }) => void;
  let heldRead: Promise<Task[]> | undefined;
  let afterWrite: ((id: number) => void) | undefined;
  let failWrite = 0;
  let failLabel: "GET" | "PUT" | "VERIFY" | undefined;
  let verificationPending = false;
  const writes: number[] = [];
  const labelsWritten: Labels[] = [];
  vi.mocked(listen).mockImplementation((_name, handler) => { signal = handler as typeof signal; return Promise.resolve(vi.fn()); });
  async function readLabels() {
    if (failLabel === "GET" || (failLabel === "VERIFY" && verificationPending)) { failLabel = undefined; throw new Error("labels offline"); }
    return data.labels;
  }
  async function writeLabels(labels: Labels) {
    labelsWritten.push(labels);
    if (failLabel === "PUT") { failLabel = undefined; throw new Error("labels write failed"); }
    data.labels = labels; verificationPending = true;
  }
  async function write(id: number, text: string) {
    writes.push(id);
    if (failWrite === id) { failWrite = 0; throw new Error("task offline"); }
    const updated = task(id, text);
    data.tasks = data.tasks.map((found) => found.id === id ? updated : found);
    afterWrite?.(id);
    return updated;
  }
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "server_connect") { connectionId = (args as { connectionId: string }).connectionId; return; }
    if (command === "get_note") return "base";
    if (command === "get_raw") return data.tasks.map((found) => found.raw + "\n").join("");
    if (command === "get_data_dir") return "/data";
    if (command === "storage_kind") return "path";
    if (command === "list_tasks") return heldRead ? await heldRead : data.tasks;
    if (command === "get_labels") return readLabels();
    if (command === "put_labels") { if (!server) await writeLabels((args as { labels: Labels }).labels); return; }
    if (command === "update_task") { const { id, text } = args as { id: number; text: string }; return write(id, text); }
    if (command === "create_task") { const updated = task(9, (args as { text: string }).text); data.tasks.push(updated); return updated; }
    if (command !== "server_fetch") return;
    if ((args as { req: { url: string } }).req.url.endsWith("/api/capabilities")) return { ok: false, status: 404, status_text: "Not Found", body: "" };
    const { req } = args as { req: { url: string; method: string; body: string } };
    const path = new URL(req.url).pathname;
    let body = "";
    if (path === "/api/tasks") body = JSON.stringify(heldRead ? await heldRead : data.tasks);
    else if (path.startsWith("/api/tasks/") && req.method === "PUT") body = JSON.stringify(await write(Number(path.split("/").pop()), JSON.parse(req.body).text));
    else if (path === "/api/labels") {
      if (req.method === "PUT") await writeLabels(JSON.parse(req.body));
      else body = JSON.stringify(await readLabels());
    } else if (path === "/api/raw") body = data.tasks.map((found) => found.raw + "\n").join("");
    else if (path === "/api/note") body = data.note;
    return { ok: true, status: 200, status_text: "OK", body };
  });
  return {
    data, writes, labelsWritten,
    signal: async (kind: string) => act(async () => { signal({ payload: { connectionId, kind } }); await settle(); }),
    afterWrite: (callback: (id: number) => void) => { afterWrite = callback; },
    holdRead: (promise?: Promise<Task[]>) => { heldRead = promise; },
    failTask: (id: number) => { failWrite = id; },
    failLabels: (stage: typeof failLabel) => { failLabel = stage; },
  };
}
const renameDialog = () => document.querySelector("#rename-project-dialog") as HTMLDialogElement;
async function openRename(name = "old") {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    await settle();
  });
  const picker = document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
  fireEvent.click(within(picker).getByRole("button", { name: `Rename ${name}` }));
  await act(settle);
  expect(picker.open).toBe(false);
  expect(renameDialog().open).toBe(true);
}
async function submitRename(name = "new") {
  fireEvent.change(within(renameDialog()).getByRole("textbox", { name: "New project name" }), { target: { value: name } });
  await act(async () => { fireEvent.submit(renameDialog().querySelector("form")!); await settle(); });
}
async function clickRename(name: string) {
  await act(async () => { fireEvent.click(within(renameDialog()).getByRole("button", { name })); await settle(); });
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(async () => { cleanup(); await settle(); localStorage.clear(); vi.useRealTimers(); });

describe("project rename through real panes and transport", () => {
  it.each([false, true])("renames active/completed tasks, follows the filter, and preserves add drafts (server=%s)", async (server) => {
    const { data, writes, labelsWritten } = fixture(server);
    render(server ? <App /> : <TodoPane compact={false} />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +old +oldish" } });
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: "old" }));
    await openRename(); await submitRename();
    expect(renameDialog().open).toBe(false);
    expect(writes).toEqual([1, 2]);
    expect(data.tasks.map((found) => found.raw)).toEqual(["first +new", "x second +new"]);
    expect(data.labels).toEqual({ project: ["new", "other"], context: ["phone"] });
    expect(labelsWritten).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Project filter" }).textContent).toBe("new");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +new +oldish");
  });
  it.each(["Cancel", "Escape", "backdrop", "same-name"])("does not write for %s", async (dismiss) => {
    const { writes, labelsWritten } = fixture(); render(<App />); await act(settle); await openRename();
    if (dismiss === "Cancel") await clickRename("Cancel");
    else if (dismiss === "Escape") { fireEvent(renameDialog(), new Event("cancel", { cancelable: true })); await act(settle); }
    else if (dismiss === "backdrop") { fireEvent.click(renameDialog()); await act(settle); }
    else await submitRename("old");
    expect(writes).toEqual([]); expect(labelsWritten).toEqual([]);
  });
  it("exposes rename through compact options without stacking pickers", async () => {
    fixture(false); render(<TodoPane compact />); await act(settle);
    fireEvent.click(screen.getByRole("button", { name: "Filter options" })); await act(settle);
    await openRename(); await submitRename();
    expect(renameDialog().open).toBe(false);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(0);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filter options" }));
  });
  it("waits for delayed own rescans, ignores duplicate submissions, and keeps busy dismissal from losing work", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename();
    const held = deferred<Task[]>(); model.afterWrite((id) => { if (id === 1) model.holdRead(held.promise); });
    await submitRename();
    expect(model.writes).toEqual([1]);
    fireEvent.submit(renameDialog().querySelector("form")!);
    fireEvent(renameDialog(), new Event("cancel", { cancelable: true })); await act(settle);
    expect(renameDialog().open).toBe(true); expect(model.writes).toEqual([1]);
    model.holdRead(); await act(async () => { held.resolve(model.data.tasks); await settle(); });
    expect(model.writes).toEqual([1, 2]); expect(model.data.labels.project).toEqual(["new", "other"]);
  });
  it("retains partial writes and retries only the remaining task", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename(); model.failTask(2);
    await submitRename(); expect(model.writes).toEqual([1, 2]);
    await clickRename("Close");
    await openRename();
    expect((within(renameDialog()).getByRole("textbox") as HTMLInputElement).value).toBe("new");
    expect(model.writes).toEqual([1, 2]);
    await clickRename("Retry rename");
    expect(model.writes).toEqual([1, 2, 2]); expect(model.data.labels.project).toEqual(["new", "other"]);
  });
  it("rejects invalid names, remembered collisions, and staged/inline draft target collisions without writes", async () => {
    const model = fixture(); render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "unsubmitted +draftTarget" } });
    await openRename();
    for (const name of ["bad name", "other", "draftTarget"]) {
      await submitRename(name);
      expect(within(renameDialog()).getByRole("alert").textContent).not.toBe("");
    }
    expect(model.writes).toEqual([]); expect(model.labelsWritten).toEqual([]);
  });
  it("does not turn a failed label GET into an empty-label overwrite", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename(); model.failLabels("GET");
    await submitRename(); expect(model.writes).toEqual([]); expect(model.labelsWritten).toEqual([]);
    expect(model.data.labels.context).toEqual(["phone"]);
  });
  it("retains unrelated task-derived project suggestions after completion", async () => {
    const model = fixture(); model.data.tasks.push(task(3, "unrelated +unremembered"));
    render(<App />); await act(settle); await openRename(); await submitRename(); expect(renameDialog().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    expect(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: "unremembered" })).toBeTruthy();
    expect(model.data.tasks[2].raw).toBe("unrelated +unremembered");
  });
  it("blocks ambiguous add drafts after partial failure until explicitly resolved", async () => {
    const model = fixture(false); render(<TodoPane compact={false} />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "retained +old" } });
    await openRename(); model.failTask(2); await submitRename(); await clickRename("Close");
    await act(async () => { fireEvent.submit(document.querySelector("#add-form")!); await settle(); });
    expect(model.data.tasks).toHaveLength(2);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("retained +old");
    await openRename();
    await clickRename("Stop retry; keep partial changes");
    expect(model.data.tasks[0].projects).toEqual(["new"]);
    expect(model.data.tasks[1].projects).toEqual(["old"]);
    expect(screen.queryByRole("button", { name: "Review rename progress" })).toBeNull();
  });
  it("keeps pending progress and stops further writes across a transport replacement", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename();
    const held = deferred<Task[]>(); model.afterWrite((id) => { if (id === 1) model.holdRead(held.promise); });
    await submitRename();
    localStorage.setItem("ntr.serverUrl", "http://different"); activateTransport();
    model.holdRead(); await act(async () => { held.resolve(model.data.tasks); await settle(); });
    expect(model.writes).toEqual([1]); expect(model.labelsWritten).toEqual([]);
    expect(renameDialog().textContent).toContain("connection changed");
  });
  it("requires explicit revalidation after same-destination TLS replacement and retains successful progress", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename(); model.failTask(2);
    await submitRename(); await clickRename("Close");
    fireEvent.click(screen.getAllByRole("button", { name: /settings/i })[0]); await act(settle);
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow self-signed certificates" }));
    fireEvent(document.querySelector("#settings-modal")!, new Event("cancel", { cancelable: true })); await act(settle);
    expect(model.writes).toEqual([1, 2]);
    await openRename();
    await clickRename("Retry rename");
    expect(model.writes).toEqual([1, 2, 2]); expect(model.data.labels.project).toEqual(["new", "other"]);
  });
  it("does not issue follow-up writes after unmount", async () => {
    const model = fixture(); const view = render(<App />); await act(settle); await openRename();
    const held = deferred<Task[]>(); model.afterWrite((id) => { if (id === 1) model.holdRead(held.promise); });
    await submitRename(); view.unmount(); model.holdRead();
    await act(async () => { held.resolve(model.data.tasks); await settle(); });
    expect(model.writes).toEqual([1]); expect(model.labelsWritten).toEqual([]);
  });
  it.each(["PUT", "VERIFY"] as const)("retains label-only progress after a label %s failure", async (stage) => {
    const model = fixture(); render(<App />); await act(settle); await openRename(); model.failLabels(stage);
    await submitRename(); expect(model.writes).toEqual([1, 2]);
    expect(renameDialog().textContent).toContain("labels");
    await clickRename("Finish labels");
    expect(model.writes).toEqual([1, 2]);
    expect(model.labelsWritten).toHaveLength(stage === "VERIFY" ? 1 : 2);
    expect(model.data.labels.project).toEqual(["new", "other"]);
  });
  it("yields a partial rename to remote review and never resumes writes without explicit retry", async () => {
    const model = fixture(); render(<App />); await act(settle); await openRename();
    model.afterWrite((id) => { if (id === 1) model.data.tasks = model.data.tasks.map((found) => found.id === 2 ? task(2, "foreign second +old") : found); });
    await submitRename(); expect(model.writes).toEqual([1]);
    expect(renameDialog().open).toBe(true); expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
    await clickRename("Review update");
    expect(renameDialog().open).toBe(false);
    const remoteDialog = document.querySelector("#remote-update") as HTMLDialogElement;
    expect(remoteDialog.open).toBe(true);
    await act(async () => { fireEvent.click(within(remoteDialog).getByRole("button", { name: "Update" })); await settle(); });
    expect(model.writes).toEqual([1]);
    await openRename();
    expect(model.writes).toEqual([1]); await clickRename("Retry rename");
    expect(model.writes).toEqual([1, 2]); expect(model.data.tasks[1].raw).toBe("foreign second +new");
  });
  it("keeps pending remote notes untouched throughout rename", async () => {
    const model = fixture(); render(<App />); await act(settle);
    const editor = screen.getByRole("textbox", { name: "Note (Markdown)" });
    setEditorText(editor as HTMLDivElement, "unsaved note draft", 18); fireEvent.input(editor);
    model.data.note = "foreign note"; await model.signal("note");
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Not now" })); await settle(); });
    await openRename(); await submitRename();
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(editor.textContent).toBe("unsaved note draft");
    expect(document.querySelector("#note-status")!.textContent).toContain("automatic saving paused");
    expect(model.data.note).toBe("foreign note");
    expect(vi.mocked(invoke).mock.calls.filter(([command, args]) => command === "server_fetch"
      && (args as { req: { url: string; method: string } }).req.url.endsWith("/api/note")
      && (args as { req: { method: string } }).req.method !== "GET")).toHaveLength(0);
  });
  it("fixes multi-task project removal with a delayed post-write validation read", async () => {
    const model = fixture(); render(<App />); await act(settle);
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: "Remove old" }));
    const held = deferred<Task[]>(); model.afterWrite((id) => { if (id === 1) model.holdRead(held.promise); });
    await act(async () => { fireEvent.click(within(document.querySelector("#remove-label-dialog") as HTMLElement).getByRole("button", { name: "Remove" })); await settle(); });
    expect(model.writes).toEqual([1]); model.holdRead();
    await act(async () => { held.resolve(model.data.tasks); await settle(); });
    expect(model.writes).toEqual([1, 2]); expect(model.data.tasks.map((found) => found.raw)).toEqual(["first", "x second"]);
    expect(model.data.labels.project).toEqual(["other"]);
  });
  it("stops project removal on genuine divergence without replaying old task IDs", async () => {
    const model = fixture(); render(<App />); await act(settle);
    model.afterWrite((id) => { if (id === 1) model.data.tasks = [model.data.tasks[0], task(90, "reassigned +old")]; });
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: "Remove old" }));
    await act(async () => { fireEvent.click(within(document.querySelector("#remove-label-dialog") as HTMLElement).getByRole("button", { name: "Remove" })); await settle(); });
    expect(model.writes).toEqual([1]); expect(model.labelsWritten).toEqual([]);
    await act(async () => { fireEvent.click(within(document.querySelector("#remove-label-dialog") as HTMLElement).getByRole("button", { name: "Review update" })); await settle(); });
    const remote = document.querySelector("#remote-update") as HTMLDialogElement;
    await act(async () => { fireEvent.click(within(remote).getByRole("button", { name: "Update" })); await settle(); });
    expect(model.writes).toEqual([1]); expect(document.querySelector("#tasks")!.textContent).toContain("reassigned");
  });
  it("remaps a suspended edit draft without resetting fields or bypassing the current identity", async () => {
    const model = fixture(false); const ref = createRef<TodoPaneHandle>(); render(<TodoPane ref={ref} compact={false} />); await act(settle);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), { target: { value: "edited +old +oldish" } });
    act(() => ref.current!.reviewRemote()); await act(settle);
    await openRename(); await submitRename(); expect(renameDialog().open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Resume task draft" }));
    expect((screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement).value).toBe("edited +new +oldish");
    await act(async () => { fireEvent.submit(document.querySelector("#edit-task-form")!); await settle(); });
    expect(model.data.tasks[0].raw).toContain("edited +new +oldish");
    expect(model.data.tasks[0].projects).not.toContain("old");
  });
});
