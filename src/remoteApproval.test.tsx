import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import App from "./App";
import type { Task } from "./api";
import { deferred, settle } from "./test/deferred";
import { setEditorText } from "./lib/caret";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
function task(id: number, raw: string): Task {
  return { id, raw, description: raw, completed: false, completion_date: null, creation_date: null, projects: ["work"], contexts: [], tags: {} };
}
function fixture() {
  const data = { note: "base", tasks: [task(1, "first +work")], localNote: "base", localRaw: "first +work\n" };
  let connectionId = "";
  let event!: (event: { payload: { connectionId: string; kind: string } }) => void;
  let holdPut: Promise<void> | undefined;
  let noteReads = 0;
  let noteRead: ((count: number) => Promise<string> | undefined) | undefined;
  let labelsFail = false;
  vi.mocked(listen).mockImplementation((_name, handler) => { event = handler as typeof event; return Promise.resolve(vi.fn()); });
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "server_connect") { connectionId = (args as { connectionId: string }).connectionId; return; }
    if (command === "get_note") return data.localNote;
    if (command === "get_raw") return data.localRaw;
    if (command === "get_data_dir") return "/data";
    if (command === "storage_kind") return "path";
    if (command !== "server_fetch") return;
    if ((args as { req: { url: string } }).req.url.endsWith("/api/capabilities")) return { ok: false, status: 404, status_text: "Not Found", body: "" };
    const { req } = args as { req: { url: string; method: string; body: string } };
    const path = new URL(req.url).pathname;
    if (path === "/api/labels" && labelsFail) { labelsFail = false; throw new Error("labels offline"); }
    if (req.method !== "GET") {
      if (path === "/api/note") { data.note = req.body; await holdPut; }
      else if (path === "/api/tasks") { data.tasks = [...data.tasks, task(20, JSON.parse(req.body).text)]; }
    }
    let body = "";
    if (path === "/api/note") body = req.method === "GET" ? await (noteRead?.(++noteReads) ?? Promise.resolve(data.note)) : data.note;
    else if (path === "/api/raw") body = data.tasks.map((t) => t.raw + "\n").join("");
    else if (path === "/api/tasks") body = JSON.stringify(req.method === "POST" ? data.tasks[data.tasks.length - 1] : data.tasks);
    else if (path === "/api/labels") body = JSON.stringify({ project: ["work"], context: [] });
    return { ok: true, status: 200, status_text: "OK", body };
  });
  return {
    data,
    signal: async (...kinds: string[]) => act(async () => { kinds.forEach((kind) => event({ payload: { connectionId, kind } })); await settle(); }),
    hold: (promise: Promise<void>) => { holdPut = promise; },
    readNote: (read: (count: number) => Promise<string> | undefined) => { noteRead = read; },
    failLabels: () => { labelsFail = true; },
  };
}
const writes = () => vi.mocked(invoke).mock.calls.filter(([command, args]) => command === "put_note" || command === "put_raw" || command === "put_labels"
  || (command === "server_fetch" && (args as { req: { method: string } }).req.method !== "GET"));
async function choose(name: "Update" | "Retry update" | "Not now") {
  await act(async () => { fireEvent.click(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name })); await settle(); });
}
async function review(resource: "note" | "tasks") {
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: `Review update for ${resource}` })); await settle(); });
}
function editNote(text: string) {
  const editor = screen.getByRole("textbox", { name: "Note (Markdown)" });
  setEditorText(editor as HTMLDivElement, text, text.length);
  fireEvent.input(editor);
  return editor;
}
beforeEach(() => { vi.clearAllMocks(); localStorage.setItem("ntr.serverUrl", "http://shared"); vi.useFakeTimers(); });
afterEach(async () => { cleanup(); await settle(); localStorage.clear(); vi.useRealTimers(); });

describe("approval across real panes", () => {
  it("retains the diff and drafts after a note preparation failure until explicit Retry update", async () => {
    const model = fixture(); render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "unsaved task +work" } });
    model.data.note = "incoming note"; await model.signal("note");
    model.readNote(() => Promise.reject(new Error("note offline")));
    await choose("Update");
    const dialog = screen.getByRole("dialog", { name: "Note update" });
    expect(within(dialog).getByLabelText("Change details").textContent).toContain("incoming note");
    expect(within(dialog).getByRole("alert").classList.contains("sr-only")).toBe(true);
    expect(within(dialog).getByRole("alert").textContent).toContain("note offline");
    expect(within(dialog).getByRole("button", { name: "Retry update" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("unsaved task +work");
    expect(writes()).toHaveLength(0);
    model.readNote(() => undefined); await choose("Retry update");
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("incoming note");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("unsaved task +work");
    expect(writes()).toHaveLength(0);
  });
  it.each(["note", "tasks"] as const)("replaces the %s diff on a changed preparation read and requires another choice", async (resource) => {
    const { data, signal } = fixture(); render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "unsubmitted draft +work" } });
    if (resource === "note") data.note = "first incoming version";
    else data.tasks = [task(90, "first incoming version +work")];
    await signal(resource);
    const details = () => within(document.querySelector("#remote-update") as HTMLElement).getByLabelText("Change details");
    expect(details().textContent).toContain(resource === "note" ? "base" : "first +work");
    expect(details().textContent).toContain("first incoming version");
    if (resource === "note") data.note = "second incoming version";
    else data.tasks = [task(91, "second incoming version +work")];
    await choose("Update");
    expect(details().textContent).toContain("second incoming version");
    expect(resource === "note" ? screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent : document.querySelector("#tasks")!.textContent).not.toContain("incoming version");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("unsubmitted draft +work");
    await choose("Update");
    expect(resource === "note" ? screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent : document.querySelector("#tasks")!.textContent).toContain("second incoming version");
    expect(writes()).toHaveLength(0);
  });
  it("keeps task and note diff baselines independent while approving their queue", async () => {
    const { data, signal } = fixture(); render(<App />); await act(settle);
    data.tasks = [task(90, "foreign task +work")]; data.note = "foreign note";
    await signal("tasks", "note");
    let preview = within(document.querySelector("#remote-update") as HTMLElement);
    expect(preview.getByLabelText("Change details").textContent).toContain("first +work");
    await choose("Update");
    preview = within(document.querySelector("#remote-update") as HTMLElement);
    expect(preview.getByLabelText("Change details").textContent).toContain("base");
    expect(preview.getByLabelText("Change details").textContent).toContain("foreign note");
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
    await choose("Not now");
    expect(document.querySelector("#tasks")!.textContent).toContain("foreign task");
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
    expect(writes()).toHaveLength(0);
  });
  it("retains a task offer when label preparation fails and retries without acknowledging unseen content", async () => {
    const { data, signal, failLabels } = fixture();
    render(<App />); await act(settle);
    data.tasks = [task(90, "changed task +work")]; await signal("tasks");
    failLabels(); await choose("Update");
    expect(document.querySelector("#tasks")!.textContent).toContain("first");
    expect(within(document.querySelector("#remote-update") as HTMLElement).getByRole("alert").textContent).toContain("labels offline");
    expect(within(document.querySelector("#remote-update") as HTMLElement).getByRole("button", { name: "Retry update" })).toBeTruthy();
    expect(writes()).toHaveLength(0);
    await choose("Retry update");
    expect(document.querySelector("#tasks")!.textContent).toContain("changed task");
    expect(writes()).toHaveLength(0);
  });

  it("does not apply an obsolete version choice when a newer note arrives", async () => {
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    const editor = editNote("draft");
    data.note = "B"; await signal("note");
    expect(within(document.querySelector("#remote-update") as HTMLElement).getByLabelText("Change details").textContent).not.toContain("draft");
    await choose("Update");
    data.note = "C"; await signal("note");
    const conflict = within(document.querySelector("#note-conflict") as HTMLElement);
    await act(async () => { fireEvent.click(conflict.getByRole("button", { name: "Use theirs" })); await settle(); });
    expect(editor.textContent).toBe("draft");
    expect(writes()).toHaveLength(0);
    await choose("Update");
    await act(async () => { fireEvent.click(conflict.getByRole("button", { name: "Use theirs" })); await settle(); });
    expect(editor.textContent).toBe("C");
    expect(writes()).toHaveLength(0);
  });

  it("preserves a baseline-return draft and save ownership through same-destination reconfiguration", async () => {
    const { signal, hold, data } = fixture();
    render(<App />); await act(settle);
    const put = deferred<void>(); hold(put.promise);
    editNote("own"); await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    editNote("base");
    fireEvent.click(screen.getAllByRole("button", { name: /settings/i })[0]); await act(settle);
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow self-signed certificates" }));
    fireEvent(document.querySelector("#settings-modal")!, new Event("cancel", { cancelable: true })); await act(settle);
    await signal("connected", "note");
    expect(writes().filter(([cmd]) => cmd === "server_fetch")).toHaveLength(1);
    await act(async () => { put.resolve(); await settle(); });
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(data.note).toBe("base");
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
  });

  it("does not import declined tasks through project filtering or an own add response", async () => {
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    data.tasks = [task(90, "foreign task +work")]; await signal("tasks"); await choose("Not now");
    fireEvent.click(screen.getByRole("button", { name: "Project filter" }));
    fireEvent.click(within(document.querySelector("dialog.select-modal[open]") as HTMLElement).getByRole("button", { name: /^work/ }));
    expect(document.querySelector("#tasks")!.textContent).toContain("first");
    expect(document.querySelector("#tasks")!.textContent).not.toContain("foreign");
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "own new +work" } });
    fireEvent.submit(document.querySelector("#add-form")!); await act(settle);
    expect(document.querySelector("#tasks")!.textContent).toContain("first");
    expect(document.querySelector("#tasks")!.textContent).toContain("own new");
    expect(document.querySelector("#tasks")!.textContent).not.toContain("foreign");
    expect(screen.getByRole("button", { name: "Review update for tasks" })).toBeTruthy();
  });

  it("does not swallow an event received during a delayed initial pane read", async () => {
    const { data, signal, readNote } = fixture();
    const initial = deferred<string>();
    readNote((count) => count === 2 ? initial.promise : undefined);
    render(<App />); await act(settle);
    data.note = "arrived during loading";
    await signal("note");
    await act(async () => { initial.resolve("base"); await settle(); });
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(true);
    expect(writes()).toHaveLength(0);
  });

  it.each(["ask", "server", "local"])("runs reconciliation on an actual destination change (%s)", async (strategy) => {
    localStorage.setItem("ntr.conflictStrategy", strategy);
    const { data } = fixture();
    render(<App />); await act(settle);
    data.note = "new server"; data.localNote = "local copy";
    fireEvent.click(screen.getAllByRole("button", { name: /settings/i })[0]); await act(settle);
    fireEvent.change(screen.getByPlaceholderText("http://127.0.0.1:8080"), { target: { value: "http://other" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect" })); await act(settle);
    if (strategy === "ask") {
      expect((document.querySelector("#conflict-dialog") as HTMLDialogElement).open).toBe(true);
      expect(writes()).toHaveLength(0);
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Use local" })); await settle(); });
      expect(data.note).toBe("local copy");
    } else if (strategy === "server") {
      expect(invoke).toHaveBeenCalledWith("put_note", { text: "new server" });
    } else {
      expect(data.note).toBe("local copy");
    }
    expect(writes()).not.toHaveLength(0);
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe(strategy === "server" ? "new server" : "local copy");
  });

  it("defers approved note application during IME and protects the committed draft on review", async () => {
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    const editor = screen.getByRole("textbox", { name: "Note (Markdown)" });
    fireEvent.compositionStart(editor);
    data.note = "remote IME update"; await signal("note"); await choose("Update");
    expect(editor.textContent).toBe("base");
    expect(screen.getByRole("button", { name: "Review update for note" })).toBeTruthy();
    setEditorText(editor as HTMLDivElement, "IME draft", 9);
    fireEvent.compositionEnd(editor); await act(settle);
    await review("note"); await choose("Update");
    expect((document.querySelector("#note-conflict") as HTMLDialogElement).open).toBe(true);
    expect(editor.textContent).toBe("IME draft");
    expect(writes()).toHaveLength(0);
  });

  it.each(["ask", "server", "local"])("retains declined state without reconciliation writes on unchanged settings and same-destination TLS changes (%s)", async (strategy) => {
    localStorage.setItem("ntr.conflictStrategy", strategy);
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    data.note = "foreign";
    await signal("note"); await choose("Not now");
    expect(writes()).toHaveLength(0);
    const connections = vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "server_connect").length;
    for (const reconfigure of [false, true]) {
      fireEvent.click(screen.getAllByRole("button", { name: /settings/i })[0]);
      await act(settle);
      if (reconfigure) fireEvent.click(screen.getByRole("checkbox", { name: "Allow self-signed certificates" }));
      fireEvent(document.querySelector("#settings-modal")!, new Event("cancel", { cancelable: true }));
      await act(settle);
      expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("base");
      expect(writes()).toHaveLength(0);
      expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
      expect(screen.getByRole("button", { name: "Review update for note" })).toBeTruthy();
    }
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "server_connect")).toHaveLength(connections + 1);
    await review("note"); await choose("Update");
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("foreign");
    expect(writes()).toHaveLength(0);
  });

  it("keeps dirty declined notes paused across input, blur, pagehide, and conflict dismissal until explicit Keep mine", async () => {
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    const editor = editNote("draft");
    data.note = "foreign"; await signal("note"); await choose("Not now");
    editNote("new draft");
    for (let i = 0; i < 2; i++) { fireEvent.blur(editor); fireEvent(window, new Event("pagehide")); }
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(writes()).toHaveLength(0);
    expect(editor.textContent).toBe("new draft");
    expect(screen.getByText("Remote update pending; automatic saving paused", { selector: "#note-status" })).toBeTruthy();
    await review("note"); await choose("Update");
    const conflict = document.querySelector("#note-conflict") as HTMLDialogElement;
    expect(conflict.open).toBe(true);
    expect(editor.textContent).toBe("new draft");
    act(() => conflict.close()); await act(settle);
    expect(writes()).toHaveLength(0);
    await review("note"); await choose("Update");
    await act(async () => { fireEvent.click(within(conflict).getByRole("button", { name: "Keep mine" })); await settle(); });
    expect(data.note).toBe("new draft");
    expect(writes().filter(([cmd]) => cmd === "server_fetch")).toHaveLength(1);
  });

  it("blocks stale task actions, preserves add/edit drafts through review, and never replays the old action", async () => {
    const { data, signal } = fixture();
    render(<App />); await act(settle);
    fireEvent.change(screen.getByRole("textbox", { name: "New task" }), { target: { value: "add draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Task description" }), { target: { value: "edit draft" } });
    data.tasks = [task(90, "replacement +work")]; await signal("tasks");
    // Editing owns the modal until review explicitly suspends it.
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
    await review("tasks"); await choose("Update");
    expect(document.querySelector("#tasks")!.textContent).toContain("replacement");
    expect((screen.getByRole("textbox", { name: "New task" }) as HTMLInputElement).value).toBe("add draft");
    fireEvent.click(screen.getByRole("button", { name: "Resume task draft" }));
    expect((screen.getByRole("textbox", { name: "Task description" }) as HTMLInputElement).value).toBe("edit draft");
    fireEvent.submit(document.querySelector("#edit-task-form")!); await act(settle);
    expect(writes()).toHaveLength(0);
    fireEvent.click(within(document.querySelector("#edit-task-modal") as HTMLElement).getByRole("button", { name: "Cancel" }));
    data.tasks = []; await signal("tasks"); await choose("Not now");
    fireEvent.click(screen.getByRole("button", { name: "Delete" })); await act(settle);
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(true);
    expect(writes()).toHaveLength(0);
    await choose("Update");
    expect(document.querySelector("#tasks")!.textContent).toBe("");
    expect(writes()).toHaveLength(0);
  });

  it("retains foreign evidence during a PUT and suppresses equal-content echoes before and after settlement", async () => {
    const { data, signal, hold } = fixture();
    render(<App />); await act(settle);
    const put = deferred<void>(); hold(put.promise);
    editNote("own");
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    await signal("note");
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
    data.note = "foreign during PUT"; await signal("note");
    await act(async () => { put.resolve(); await settle(); });
    expect(screen.getByRole("textbox", { name: "Note (Markdown)" }).textContent).toBe("own");
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(true);
    expect(writes().filter(([cmd]) => cmd === "server_fetch")).toHaveLength(1);
  });

  it("equal-content lag rescans do not prompt or write", async () => {
    const { signal } = fixture();
    render(<App />); await act(settle);
    await signal("tasks", "note", "tasks", "note");
    expect((document.querySelector("#remote-update") as HTMLDialogElement).open).toBe(false);
    expect(writes()).toHaveLength(0);
  });
});
