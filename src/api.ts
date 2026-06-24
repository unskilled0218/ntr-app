// The transport shim: the ONLY file that knows about Tauri (`invoke`, `listen`) or the HTTP
// server (`fetch`, `EventSource`). Every component calls these functions. When a server URL
// is configured via `settings.ts`, calls go to the HTTP API; otherwise they use local Tauri
// commands. Mirrors the helper layer of web/app.js (api()/fetchNote()/putNote()).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getConflictStrategy, getServerUrl } from "./settings";
import { classifyConflict } from "./lib/conflict";

// Task shape — exactly the backend's TaskDto (src-tauri/src/dto.rs), itself the server's shape.
export interface Task {
  id: number;
  completed: boolean;
  priority: string | null;
  completion_date: string | null;
  creation_date: string | null;
  description: string;
  projects: string[];
  contexts: string[];
  tags: Record<string, string>;
  raw: string;
}

// Filters for listing tasks — the server's query params, now command arguments.
export interface TaskFilter {
  completed?: boolean | null;
  priority?: string | null;
  project?: string | null;
  context?: string | null;
}

// Live-update event name + payload tokens. These mirror the Rust `Change` enum / CHANGE_EVENT in
// src-tauri/src/watch.rs — keep the two ends in sync. A typo here fails silently (no event fires).
export const CHANGE_EVENT = "change";
export const CHANGE_TASKS = "tasks";
export const CHANGE_NOTE = "note";

// --- HTTP helpers (server mode only) ---

async function httpFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(getServerUrl() + path, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res;
}

async function httpJson<T>(path: string, init?: RequestInit): Promise<T> {
  return (await httpFetch(path, init)).json() as Promise<T>;
}

// The note and todo.txt endpoints exchange plain text. These two helpers are the
// single home for "GET/PUT text at a server path", shared by the user-write path
// (getNote/putNote) and the conflict path (CONFLICT_IO) so they cannot drift.
function httpText(path: string): Promise<string> {
  return httpFetch(path).then((r) => r.text());
}

function httpPutText(path: string, text: string): Promise<void> {
  return httpFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "text/plain" },
    body: text,
  }).then(() => {});
}

// --- Local backup helpers (server mode only, best-effort) ---

async function backupNoteLocally(text: string): Promise<void> {
  try {
    await invoke("put_note", { text });
  } catch (e) {
    console.warn("local note backup failed:", e);
  }
}

async function backupTasksLocally(): Promise<void> {
  try {
    // /api/raw is the server store's own todo.txt render — the single canonical
    // "server tasks as text" source, also used by the conflict reconcile path.
    const raw = await httpText("/api/raw");
    await invoke("put_raw", { text: raw });
  } catch (e) {
    console.warn("local task backup failed:", e);
  }
}

// --- Exported API ---

export function listTasks(filter: TaskFilter): Promise<Task[]> {
  const url = getServerUrl();
  if (url) {
    const params = new URLSearchParams();
    if (filter.completed != null) params.set("completed", String(filter.completed));
    if (filter.priority != null) params.set("priority", filter.priority);
    if (filter.project != null) params.set("project", filter.project);
    if (filter.context != null) params.set("context", filter.context);
    const qs = params.toString();
    return httpJson<Task[]>("/api/tasks" + (qs ? "?" + qs : ""));
  }
  return invoke("list_tasks", {
    completed: filter.completed ?? null,
    priority: filter.priority ?? null,
    project: filter.project ?? null,
    context: filter.context ?? null,
  });
}

export async function createTask(text: string): Promise<Task> {
  if (getServerUrl()) {
    const task = await httpJson<Task>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await backupTasksLocally();
    return task;
  }
  return invoke("create_task", { text });
}

export async function updateTask(id: number, text: string): Promise<Task> {
  if (getServerUrl()) {
    const task = await httpJson<Task>(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    await backupTasksLocally();
    return task;
  }
  return invoke("update_task", { id, text });
}

export async function completeTask(id: number): Promise<Task> {
  if (getServerUrl()) {
    const task = await httpJson<Task>(`/api/tasks/${id}/complete`, { method: "POST" });
    await backupTasksLocally();
    return task;
  }
  return invoke("complete_task", { id });
}

export async function uncompleteTask(id: number): Promise<Task> {
  if (getServerUrl()) {
    const task = await httpJson<Task>(`/api/tasks/${id}/uncomplete`, { method: "POST" });
    await backupTasksLocally();
    return task;
  }
  return invoke("uncomplete_task", { id });
}

export async function deleteTask(id: number): Promise<void> {
  if (getServerUrl()) {
    await httpFetch(`/api/tasks/${id}`, { method: "DELETE" });
    await backupTasksLocally();
    return;
  }
  return invoke("delete_task", { id });
}

export function getNote(): Promise<string> {
  if (getServerUrl()) {
    return httpText("/api/note");
  }
  return invoke("get_note");
}

export async function putNote(text: string): Promise<void> {
  if (getServerUrl()) {
    await httpPutText("/api/note", text);
    await backupNoteLocally(text);
    return;
  }
  return invoke("put_note", { text });
}

// Subscribe to the backend's `change` stream. In local mode the callback receives the payload
// token via Tauri's `listen`; in server mode it uses an SSE EventSource on /api/events.
// Returns the unlisten/close function.
export function onChange(handler: (kind: string) => void): Promise<UnlistenFn> {
  const url = getServerUrl();
  if (url) {
    const es = new EventSource(url + "/api/events");
    es.addEventListener("change", (e) => handler((e as MessageEvent).data));
    return Promise.resolve(() => es.close());
  }
  return listen<string>(CHANGE_EVENT, (e) => handler(e.payload));
}

// --- Server/local conflict reconciliation ---

export type ConflictResource = "note" | "tasks";
export type ConflictChoice = "server" | "local";

export interface Conflict {
  resource: ConflictResource;
  local: string;
  server: string;
}

// The four operations each resource needs on both sides of the reconcile. One
// table is the single source of truth for "where do the local and server copies
// of the note / todo.txt live", shared by reconcileWithServer and resolveConflict.
interface ResourceIO {
  readLocal(): Promise<string>;
  readServer(): Promise<string>;
  writeLocal(text: string): Promise<void>;
  writeServer(text: string): Promise<void>;
}

const CONFLICT_IO: Record<ConflictResource, ResourceIO> = {
  note: {
    readLocal: () => invoke("get_note"),
    readServer: () => httpText("/api/note"),
    writeLocal: (text) => invoke("put_note", { text }),
    writeServer: (text) => httpPutText("/api/note", text),
  },
  tasks: {
    // /api/raw is the server store's own todo.txt render, byte-for-byte the format
    // local get_raw returns — so equal content compares equal, no join/newline logic.
    readLocal: () => invoke("get_raw"),
    readServer: () => httpText("/api/raw"),
    writeLocal: (text) => invoke("put_raw", { text }),
    writeServer: (text) => httpPutText("/api/raw", text),
  },
};

// "server" writes the server copy down to the local file; "local" pushes the
// local copy up to the server. Either way both sides end up identical.
function applyChoice(c: Conflict, choice: ConflictChoice): Promise<void> {
  const io = CONFLICT_IO[c.resource];
  return choice === "server" ? io.writeLocal(c.server) : io.writeServer(c.local);
}

// Reconcile the local todo.txt / Note.md with a server's copies. Called on app
// open and after connecting. For each resource: identical copies are left alone;
// a difference with an empty local copy adopts the server silently; a real
// difference is resolved per the configured strategy ("server"/"local" auto-apply,
// "ask" is returned for the UI to prompt). Best-effort: a failure on one resource
// is logged and does not block the other. No-op (returns []) in local mode.
export async function reconcileWithServer(): Promise<Conflict[]> {
  if (!getServerUrl()) return [];
  const strategy = getConflictStrategy();
  const conflicts: Conflict[] = [];
  for (const resource of ["note", "tasks"] as ConflictResource[]) {
    try {
      const io = CONFLICT_IO[resource];
      const [local, server] = await Promise.all([io.readLocal(), io.readServer()]);
      const verdict = classifyConflict(local, server);
      if (verdict === "in-sync") continue;
      const conflict: Conflict = { resource, local, server };
      if (verdict === "adopt-server") {
        await applyChoice(conflict, "server");
      } else if (strategy === "ask") {
        conflicts.push(conflict);
      } else {
        await applyChoice(conflict, strategy); // narrowed to "server" | "local"
      }
    } catch (e) {
      console.warn(`reconcile ${resource} failed:`, e);
    }
  }
  return conflicts;
}

// Apply the user's dialog choice for one conflict. "server" overwrites the local
// file with the server copy; "local" pushes the local copy to the server.
export function resolveConflict(c: Conflict, choice: ConflictChoice): Promise<void> {
  return applyChoice(c, choice);
}

export function getDataDir(): Promise<string> {
  return invoke("get_data_dir");
}

export function setDataDir(dir: string): Promise<void> {
  return invoke("set_data_dir", { dir });
}

// Turn any thrown value into a message. IPC rejections arrive as plain strings (the Rust
// commands return Result<_, String>); JS failures arrive as Error. The one home for that
// decision, next to the boundary that produces them.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
