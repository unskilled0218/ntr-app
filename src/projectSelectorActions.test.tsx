import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { createRef } from "react";
import App from "./App";
import TodoPane, { type TodoPaneHandle } from "./components/TodoPane";
import { activateTransport, type Task, type Labels } from "./api";
import { settle } from "./test/deferred";
import { setEditorText } from "./lib/caret";
import { setCompactUi } from "./settings";
import { deferDialogCloseEvents } from "./test/dialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
const task = (id: number, raw: string): Task => ({ id, raw, description: raw, completed: false, completion_date: null, creation_date: null,
  projects: raw.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1)), contexts: [], tags: {} });
function fixture(server = true) {
  localStorage.setItem("ntr.serverUrl", server ? "http://one" : ""); activateTransport();
  const makeData = () => ({ tasks: [task(1, "first +work"), task(2, "second +work")], labels: { project: ["work", "other"], context: ["phone"] } as Labels, note: "base" });
  const data = makeData(), other = makeData();
  const writes: { url: string; kind: string; id?: number; text?: string }[] = [];
  let event!: (event: { payload: { connectionId: string; kind: string } }) => void;
  let connectionId = "";
  let failTask = 0;
  let failLabel: "reject" | "committed" | undefined;
  let afterWrite: ((id: number) => void) | undefined;
  vi.mocked(listen).mockImplementation((_name, callback) => { event = callback as typeof event; return Promise.resolve(vi.fn()); });
  async function writeTask(store: typeof data, id: number, raw: string, url: string) {
    writes.push({ url, kind: "task", id, text: raw });
    if (id === failTask) { failTask = 0; throw new Error("task offline"); }
    const updated = task(id, raw); store.tasks = store.tasks.map((found) => found.id === id ? updated : found);
    afterWrite?.(id); return updated;
  }
  async function writeLabels(store: typeof data, labels: Labels, url: string) {
    writes.push({ url, kind: "labels" });
    if (failLabel === "reject") { failLabel = undefined; throw new Error("labels offline"); }
    store.labels = labels;
    if (failLabel === "committed") { failLabel = undefined; throw new Error("label response lost"); }
  }
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "server_connect") { connectionId = (args as { connectionId: string }).connectionId; return; }
    if (command === "get_note") return "base";
    if (command === "get_raw") return data.tasks.map((found) => found.raw + "\n").join("");
    if (command === "get_data_dir") return "/data";
    if (command === "storage_kind") return "path";
    if (command === "list_tasks") return data.tasks;
    if (command === "get_labels") return data.labels;
    if (command === "put_labels") { if (!server) await writeLabels(data, (args as { labels: Labels }).labels, "local"); return; }
    if (command === "update_task") { const { id, text } = args as { id: number; text: string }; return writeTask(data, id, text, "local"); }
    if (command === "create_task") { const created = task(9, (args as { text: string }).text); data.tasks.push(created); writes.push({ url: "local", kind: "create", text: created.raw }); return created; }
    if (command !== "server_fetch") return;
    if ((args as { req: { url: string } }).req.url.endsWith("/api/capabilities")) return { ok: false, status: 404, status_text: "Not Found", body: "" };
    const { req } = args as { req: { url: string; method: string; body: string } };
    const url = new URL(req.url); const store = url.hostname === "two" ? other : data;
    let body = "";
    if (url.pathname === "/api/tasks") {
      if (req.method === "POST") { const created = task(9, JSON.parse(req.body).text); store.tasks.push(created); writes.push({ url: url.origin, kind: "create", text: created.raw }); body = JSON.stringify(created); }
      else body = JSON.stringify(store.tasks);
    } else if (url.pathname.startsWith("/api/tasks/") && req.method === "PUT") body = JSON.stringify(await writeTask(store, Number(url.pathname.split("/").pop()), JSON.parse(req.body).text, url.origin));
    else if (url.pathname === "/api/labels") {
      if (req.method === "PUT") await writeLabels(store, JSON.parse(req.body), url.origin);
      else body = JSON.stringify(store.labels);
    } else if (url.pathname === "/api/raw") body = store.tasks.map((found) => found.raw + "\n").join("");
    else if (url.pathname === "/api/note") {
      if (req.method !== "GET") writes.push({ url: url.origin, kind: "note" });
      body = store.note;
    }
    return { ok: true, status: 200, status_text: "OK", body };
  });
  return { data, other, writes,
    failTask: (id: number) => { failTask = id; }, failLabel: (mode: typeof failLabel) => { failLabel = mode; },
    afterWrite: (callback?: typeof afterWrite) => { afterWrite = callback; },
    signal: async (kind: string) => act(async () => { event({ payload: { connectionId, kind } }); await settle(); }),
  };
}
type Origin = "add" | "filter";
const currentPicker = () => document.querySelector("dialog.select-modal[open]") as HTMLDialogElement;
async function picker(origin: Origin = "add") {
  const label = origin === "add" ? "Project" : "Project filter";
  const existing = currentPicker();
  if (existing?.getAttribute("aria-label") === label) return existing;
  if (existing) { fireEvent.click(within(existing).getByRole("button", { name: "Cancel" })); await act(settle); }
  if (!screen.queryByRole("button", { name: label })) {
    fireEvent.click(screen.getByRole("button", { name: origin === "add" ? "Task options" : "Filter options" })); await act(settle);
  }
  fireEvent.click(screen.getByRole("button", { name: label })); await act(settle);
  return currentPicker();
}
async function action(kind: "Rename" | "Remove", name = "work", origin: Origin = "add") {
  const opened = await picker(origin);
  fireEvent.click(within(opened).getByRole("button", { name: `${kind} ${name}` })); await act(settle);
  const renameOpen = dialog("rename").open || dialog("rename", true).open;
  expect(opened.open).toBe(origin === "add" && renameOpen);
}
const dialog = (kind: "rename" | "remove", draft = false) => document.querySelector(draft ? `#draft-${kind}-project-dialog` : kind === "rename" ? "#rename-project-dialog" : "#remove-label-dialog") as HTMLDialogElement;
async function clickDialog(kind: "rename" | "remove", name: string, draft = false) {
  await act(async () => { fireEvent.click(within(dialog(kind, draft)).getByRole("button", { name })); await settle(); });
}
async function rename(to: string, draft = false) {
  fireEvent.change(within(dialog("rename", draft)).getByRole("textbox"), { target: { value: to } });
  await act(async () => { fireEvent.submit(dialog("rename", draft).querySelector("form")!); await settle(); });
}
async function stage(name: string) {
  const opened = await picker();
  fireEvent.click(within(opened).getByRole("button", { name: "+ Add project..." })); await act(settle);
  const modal = document.querySelector("#label-modal[open]") as HTMLElement;
  fireEvent.change(within(modal).getByRole("textbox"), { target: { value: name } });
  await act(async () => { fireEvent.submit(within(modal).getByRole("button", { name: "Add" }).closest("form")!); await settle(); });
}
beforeEach(() => { vi.clearAllMocks(); vi.useFakeTimers(); });
afterEach(async () => { cleanup(); await settle(); localStorage.clear(); vi.useRealTimers(); });

describe("project selector actions", () => {
  it.each([false, true].flatMap((compact) => ["Cancel", "Escape", "backdrop", "same-name"].map((method) => ({ compact, method }))))(
    "dismisses only rename and keeps its original selector usable ($method, compact=$compact)", async ({ compact, method }) => {
      const model = fixture(false); render(<TodoPane compact={compact} />); await act(settle);
      fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "unsaved +work" } });
      const opened = await picker();
      fireEvent.click(within(opened).getByRole("button", { name: "Rename work" })); await act(settle);
      expect(within(dialog("rename")).getByText("Original")).toBeTruthy();
      expect(within(dialog("rename")).getByText("work")).toBeTruthy();
      expect(within(dialog("rename")).queryByRole("status")).toBeNull();
      if (method === "Cancel") await clickDialog("rename", "Cancel");
      else if (method === "Escape") { fireEvent(dialog("rename"), new Event("cancel", { cancelable: true })); await act(settle); }
      else if (method === "backdrop") { fireEvent.click(dialog("rename")); await act(settle); }
      else await rename("work");
      expect(dialog("rename").open).toBe(false); expect(currentPicker()).toBe(opened);
      expect(document.activeElement).toBe(within(opened).getByRole("button", { name: "Rename work" }));
      expect(document.querySelectorAll("dialog[open]")).toHaveLength(compact ? 2 : 1);
      expect(model.writes).toEqual([]);
      expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("unsaved +work");
      fireEvent.click(within(opened).getByRole("button", { name: "other" })); await act(settle);
      expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("other");
    },
  );
  it.each([false, true])("restores the committed target row after mapping a staged old source (compact=%s)", async (compact) => {
    const model = fixture(); setCompactUi(compact); render(<App />); await act(settle); await stage("work");
    await action("Rename"); const opened = currentPicker(); await rename("team");
    expect(dialog("rename").open).toBe(false); expect(currentPicker()).toBe(opened);
    expect(within(opened).queryByRole("button", { name: "Rename work" })).toBeNull();
    const target = within(opened).getByRole("button", { name: "Rename team" });
    expect(document.activeElement).toBe(target); expect(target.isConnected).toBe(true);
    expect(model.data.tasks.every((found) => found.projects.includes("team"))).toBe(true);
  });
  it.each([false, true])("restores a staged-only target after its state commit (compact=%s)", async (compact) => {
    const model = fixture(false); render(<TodoPane compact={compact} />); await act(settle); await stage("scratch");
    await action("Rename", "scratch"); const opened = currentPicker(); await rename("newScratch", true);
    expect(dialog("rename", true).open).toBe(false); expect(currentPicker()).toBe(opened);
    expect(within(opened).queryByRole("button", { name: "Rename scratch" })).toBeNull();
    expect(document.activeElement).toBe(within(opened).getByRole("button", { name: "Rename newScratch" }));
    expect(model.writes).toEqual([]);
  });
  it("ignores delayed child-close events after reopening rename over the same picker", async () => {
    fixture(false); render(<TodoPane compact />); await act(settle); await action("Rename");
    const opened = currentPicker(), delayed = deferDialogCloseEvents();
    try {
      await clickDialog("rename", "Cancel");
      fireEvent.click(within(opened).getByRole("button", { name: "Rename work" })); await act(settle);
      await act(async () => { delayed.flush(); await settle(); });
      expect(dialog("rename").open).toBe(true); expect(currentPicker()).toBe(opened);
      expect(document.querySelectorAll("dialog[open]")).toHaveLength(3);
    } finally { delayed.restore(); }
  });
  it("keeps the selector after explicit rename abandonment without undoing partial work", async () => {
    const model = fixture(false); render(<TodoPane compact />); await act(settle);
    await action("Rename"); model.failTask(2); await rename("team");
    const opened = currentPicker();
    await clickDialog("rename", "Stop retry; keep partial changes");
    expect(dialog("rename").open).toBe(false); expect(currentPicker()).toBe(opened);
    expect(document.activeElement).toBe(within(opened).getByRole("button", { name: "Rename work" }));
    expect(model.data.tasks.map((found) => found.raw)).toEqual(["first +team", "second +work"]);
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1, 2]);
  });
  it.each([false, true])("releases the entire rename stack for approval without implicit retry (compact=%s)", async (compact) => {
    const model = fixture(); setCompactUi(compact); render(<App />); await act(settle);
    model.afterWrite((id) => { if (id === 1) model.data.tasks[1] = task(90, "foreign +work"); });
    await action("Rename"); await rename("team");
    expect(dialog("rename").open).toBe(true); expect(currentPicker().open).toBe(true);
    await clickDialog("rename", "Review update");
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(1);
    const remote = document.querySelector("#remote-update") as HTMLDialogElement;
    expect(remote.open).toBe(true); expect(remote.textContent).toContain("foreign +work");
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1]);
    await act(async () => { fireEvent.click(within(remote).getByRole("button", { name: "Update" })); await settle(); });
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1]);
    model.afterWrite(); await action("Rename"); await clickDialog("rename", "Retry rename");
    expect(dialog("rename").open).toBe(false); expect(currentPicker().open).toBe(true);
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1, 90]);
  });
  it.each([false, true])("offers icon-only actions from the create selector without submitting its draft (compact=%s)", async (compact) => {
    const model = fixture(false); render(<TodoPane compact={compact} />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +work +workshop" } });
    const opened = await picker();
    for (const name of ["Rename work", "Remove work"]) {
      const button = within(opened).getByRole("button", { name });
      expect(button.textContent).toBe(""); expect(button.querySelector('svg[aria-hidden="true"][focusable="false"]')).toBeTruthy();
      expect(button.title).toBe(name);
    }
    expect(within(opened).queryByRole("button", { name: "Remove None" })).toBeNull();
    fireEvent.click(within(opened).getByRole("button", { name: "Rename work" })); await act(settle);
    expect(document.querySelectorAll("dialog[open]")).toHaveLength(compact ? 3 : 2);
    await rename("team"); expect(dialog("rename").open).toBe(false); expect(opened.open).toBe(true);
    expect(model.data.tasks.map((found) => found.raw)).toEqual(["first +team", "second +team"]);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +team +workshop");
    expect(model.writes.filter((write) => write.kind === "create")).toHaveLength(0);
    expect(document.activeElement).toBe(within(opened).getByRole("button", { name: "Rename team" }));
    expect(screen.queryByText("Review rename progress")).toBeNull();
  });
  it.each([false, true])("removes a global project without deleting tasks or losing unrelated fields (server=%s)", async (server) => {
    const model = fixture(server); render(server ? <App /> : <TodoPane compact={false} />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +work +other" } });
    fireEvent.change(screen.getAllByLabelText("Due date")[0], { target: { value: "2026-11-01" } });
    await action("Remove"); await clickDialog("remove", "Remove");
    expect(dialog("remove").textContent).toContain("Removal completed");
    expect(model.data.tasks.map((found) => found.raw)).toEqual(["first", "second"]);
    expect(model.data.labels).toEqual({ project: ["other"], context: ["phone"] });
    await clickDialog("remove", "Close");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +other");
    expect((screen.getAllByLabelText("Due date")[0] as HTMLInputElement).value).toBe("2026-11-01");
    expect(model.writes.filter((write) => write.kind === "create")).toHaveLength(0);
  });
  it.each(["Cancel", "Escape", "backdrop"])("cancels global project actions without draft or store changes (%s)", async (how) => {
    const model = fixture(); render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "retained" } });
    await action("Remove");
    if (how === "Cancel") await clickDialog("remove", "Cancel");
    else if (how === "Escape") { fireEvent(dialog("remove"), new Event("cancel", { cancelable: true })); await act(settle); }
    else { fireEvent.click(dialog("remove")); await act(settle); }
    expect(model.writes).toEqual([]); expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("retained");
  });
  it("renames and removes staged-only choices without native/server writes", async () => {
    const model = fixture(); render(<App />); await act(settle); await stage("draftOnly");
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +draftOnly +workshop" } });
    await action("Rename", "draftOnly"); expect(dialog("rename", true).textContent).toContain("draft only");
    await rename("draftNew", true);
    expect(model.writes).toEqual([]);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +draftNew +workshop");
    await action("Remove", "draftNew"); await clickDialog("remove", "Remove", true);
    expect(model.writes).toEqual([]);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +workshop");
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("None");
  });
  it("rejects staged collisions and cancels staged prompts without losing state", async () => {
    const model = fixture(false); render(<TodoPane compact={false} />); await act(settle); await stage("draftOnly");
    await action("Rename", "draftOnly"); await rename("other", true);
    expect(within(dialog("rename", true)).getByRole("alert").textContent).toContain("already exists");
    await clickDialog("rename", "Cancel", true);
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("draftOnly"); expect(model.writes).toEqual([]);
  });
  it("does not redirect an unrelated staged rename into a retained operation's reserved target", async () => {
    const model = fixture(); render(<App />); await act(settle);
    await action("Rename"); model.failTask(2); await rename("team"); await clickDialog("rename", "Close");
    await stage("scratch"); const before = model.writes.length;
    await action("Rename", "scratch"); await rename("team", true);
    expect(within(dialog("rename", true)).getByRole("alert").textContent).toContain("unfinished project operation");
    expect(model.writes).toHaveLength(before); expect(dialog("rename").open).toBe(false);
    await clickDialog("rename", "Cancel", true);
    expect(screen.getByRole("button", { name: "Project" }).textContent).toBe("scratch");
  });
  it("keeps compact staged-only rename above its parent modals without a store write", async () => {
    const model = fixture(false); render(<TodoPane compact />); await act(settle); await stage("scratch");
    await action("Rename", "scratch"); expect(document.querySelectorAll("dialog[open]")).toHaveLength(3);
    await rename("scratchNew", true);
    expect(document.activeElement).toBe(within(currentPicker()).getByRole("button", { name: "Rename scratchNew" }));
    await action("Remove", "scratchNew");
    fireEvent(dialog("remove", true), new Event("cancel", { cancelable: true })); await act(settle);
    expect(model.writes).toEqual([]);
    const opened = await picker(); expect(within(opened).getByRole("button", { name: "scratchNew" })).toBeTruthy();
  });
  it("retains partial removal and its guarded draft across Close, then retries remaining work", async () => {
    const model = fixture(); render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +work" } });
    await action("Remove"); model.failTask(2); await clickDialog("remove", "Remove"); await clickDialog("remove", "Close");
    await act(async () => { fireEvent.submit(document.querySelector("#add-form")!); await settle(); });
    expect(model.writes.filter((write) => write.kind === "create")).toHaveLength(0);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +work");
    await action("Remove"); expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1, 2]);
    await clickDialog("remove", "Retry removal");
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1, 2, 2]);
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft");
  });
  it("recovers uncertain removal labels from a selector fallback when the source row disappears", async () => {
    const model = fixture(); render(<App />); await act(settle);
    await action("Remove"); model.failLabel("committed"); await clickDialog("remove", "Remove"); await clickDialog("remove", "Close");
    // Approval of an independent task change refreshes current label choices without resolving removal.
    model.data.tasks.push(task(3, "unrelated")); await model.signal("tasks");
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Update" })); await settle(); });
    const opened = await picker(); expect(within(opened).queryByRole("button", { name: "Remove work" })).toBeNull();
    fireEvent.click(within(opened).getByRole("button", { name: /Resume unfinished removal/ })); await act(settle);
    const writes = model.writes.length; await clickDialog("remove", "Finish labels");
    expect(model.writes).toHaveLength(writes); expect(dialog("remove").textContent).toContain("completed");
  });
  it("explicit abandonment releases a partial-removal guard without rollback or draft mapping", async () => {
    const model = fixture(false); render(<TodoPane compact={false} />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "draft +work" } });
    await action("Remove"); model.failTask(2); await clickDialog("remove", "Remove");
    const count = model.writes.length; await clickDialog("remove", "Stop retry; keep partial changes");
    expect(model.writes).toHaveLength(count); expect(model.data.tasks[0].raw).toBe("first");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("draft +work");
    await act(async () => { fireEvent.submit(document.querySelector("#add-form")!); await settle(); });
    expect(model.writes.filter((write) => write.kind === "create")).toHaveLength(1);
  });
  it("prioritizes retained rename over a staged-only source after known choices move to the target", async () => {
    const model = fixture(); render(<App />); await act(settle); await stage("work");
    await action("Rename"); model.failLabel("committed"); await rename("team"); await clickDialog("rename", "Close");
    fireEvent.click(within(currentPicker()).getByRole("button", { name: "Cancel" })); await act(settle);
    model.data.tasks.push(task(3, "unrelated")); await model.signal("tasks");
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Update" })); await settle(); });
    const before = model.writes.length;
    await action("Rename", "work");
    expect(dialog("rename").open).toBe(true); expect(dialog("rename", true).open).toBe(false);
    expect((within(dialog("rename")).getByRole("textbox") as HTMLInputElement).value).toBe("team");
    expect(model.writes).toHaveLength(before); await clickDialog("rename", "Close");
    await action("Remove", "work"); expect(dialog("rename").open).toBe(true); expect(dialog("remove", true).open).toBe(false);
    expect(model.writes).toHaveLength(before);
  });
  it("keeps rename resolution reachable when neither source nor target appears in current rows", async () => {
    const model = fixture(); render(<App />); await act(settle);
    await action("Rename"); model.failLabel("committed"); await rename("team"); await clickDialog("rename", "Close");
    fireEvent.click(within(currentPicker()).getByRole("button", { name: "Cancel" })); await act(settle);
    model.data.tasks = []; model.data.labels.project = ["other"]; await model.signal("tasks");
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Update" })); await settle(); });
    const before = model.writes.length, opened = await picker("filter");
    expect(within(opened).queryByRole("button", { name: "work" })).toBeNull();
    expect(within(opened).queryByRole("button", { name: "team" })).toBeNull();
    fireEvent.click(within(opened).getByRole("button", { name: /Resume unfinished rename/ })); await act(settle);
    expect(model.writes).toHaveLength(before); await clickDialog("rename", "Stop retry; keep partial changes");
    expect(model.writes).toHaveLength(before); expect(screen.queryByText("Review rename progress")).toBeNull();
  });
  it("does not let an unrelated global action replace a pending result", async () => {
    const model = fixture(); render(<App />); await act(settle);
    await action("Remove"); model.failTask(2); await clickDialog("remove", "Remove"); await clickDialog("remove", "Close");
    const before = model.writes.length; await action("Rename", "other", "filter");
    expect(dialog("remove").open).toBe(true); expect(dialog("rename").open).toBe(false);
    expect(dialog("remove").textContent).toContain("pending operation"); expect(model.writes).toHaveLength(before);
  });
  it("hands partial removal off to approval and requires explicit retry", async () => {
    const model = fixture(); render(<App />); await act(settle);
    model.afterWrite((id) => { if (id === 1) model.data.tasks[1] = task(90, "foreign +work"); });
    await action("Remove"); await clickDialog("remove", "Remove");
    await clickDialog("remove", "Review update"); expect(dialog("remove").open).toBe(false);
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Update" })); await settle(); });
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1]);
    model.afterWrite(); await action("Remove"); await clickDialog("remove", "Retry removal");
    expect(model.writes.filter((write) => write.kind === "task").map((write) => write.id)).toEqual([1, 90]);
  });
  it("keeps pending dirty notes paused while using selector actions", async () => {
    const model = fixture(); render(<App />); await act(settle);
    const editor = screen.getByRole("textbox", { name: "Note (Markdown)" }); setEditorText(editor as HTMLDivElement, "draft", 5); fireEvent.input(editor);
    model.data.note = "foreign"; await model.signal("note");
    await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Not now" })); await settle(); });
    await action("Remove"); await clickDialog("remove", "Remove"); await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(editor.textContent).toBe("draft"); expect(model.writes.filter((write) => write.kind === "note")).toHaveLength(0);
  });
  it("rebases a suspended edit draft only onto its own confirmed removal response", async () => {
    const model = fixture(false), ref = createRef<TodoPaneHandle>(); render(<TodoPane compact={false} ref={ref} />); await act(settle);
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), { target: { value: "edited +work" } });
    fireEvent.change(within(document.querySelector("#edit-task-modal") as HTMLElement).getByLabelText("Due date"), { target: { value: "2026-11-01" } });
    act(() => ref.current!.reviewRemote()); await act(settle);
    await action("Remove"); await clickDialog("remove", "Remove"); await clickDialog("remove", "Close");
    fireEvent.click(screen.getByRole("button", { name: "Resume task draft" }));
    expect((screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement).value).toBe("edited");
    await act(async () => { fireEvent.submit(document.querySelector("#edit-task-form")!); await settle(); });
    expect(model.data.tasks[0].raw).toContain("edited due:2026-11-01"); expect(model.data.tasks[0].projects).not.toContain("work");
  });
  it("preserves old-destination progress while operating on the same bare project name elsewhere", async () => {
    const model = fixture(); const ref = createRef<TodoPaneHandle>(); render(<TodoPane compact={false} ref={ref} />); await act(settle);
    await action("Rename"); model.failTask(2); await rename("team"); await clickDialog("rename", "Close");
    localStorage.setItem("ntr.serverUrl", "http://two"); activateTransport(); act(() => ref.current!.onTasksChanged()); await act(settle);
    await action("Remove"); expect(dialog("remove").open).toBe(true); expect(dialog("rename").open).toBe(false);
    await clickDialog("remove", "Remove"); await clickDialog("remove", "Close");
    expect(model.other.tasks.map((found) => found.raw)).toEqual(["first", "second"]);
    const opened = await picker(); fireEvent.click(within(opened).getByRole("button", { name: /Resume unfinished rename.*server:http:\/\/one/ })); await act(settle);
    expect(within(dialog("rename")).getByRole("button", { name: "Retry rename" }).hasAttribute("disabled")).toBe(true);
    const before = model.writes.length; fireEvent.submit(dialog("rename").querySelector("form")!); await act(settle);
    expect(model.writes).toHaveLength(before); expect(model.data.tasks[0].raw).toBe("first +team");
  });
});
