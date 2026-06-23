// The transport shim: the ONLY file that knows about Tauri (`invoke`, `listen`) or the HTTP
// server (`fetch`, `EventSource`). Every component calls these functions. When a server URL
// is configured via `settings.ts`, calls go to the HTTP API; otherwise they use local Tauri
// commands. Mirrors the helper layer of web/app.js (api()/fetchNote()/putNote()).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getServerUrl } from "./settings";

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

export function createTask(text: string): Promise<Task> {
  if (getServerUrl()) {
    return httpJson<Task>("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }
  return invoke("create_task", { text });
}

export function updateTask(id: number, text: string): Promise<Task> {
  if (getServerUrl()) {
    return httpJson<Task>(`/api/tasks/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  }
  return invoke("update_task", { id, text });
}

export function completeTask(id: number): Promise<Task> {
  if (getServerUrl()) {
    return httpJson<Task>(`/api/tasks/${id}/complete`, { method: "POST" });
  }
  return invoke("complete_task", { id });
}

export function uncompleteTask(id: number): Promise<Task> {
  if (getServerUrl()) {
    return httpJson<Task>(`/api/tasks/${id}/uncomplete`, { method: "POST" });
  }
  return invoke("uncomplete_task", { id });
}

export function deleteTask(id: number): Promise<void> {
  if (getServerUrl()) {
    return httpFetch(`/api/tasks/${id}`, { method: "DELETE" }).then(() => undefined);
  }
  return invoke("delete_task", { id });
}

export function getNote(): Promise<string> {
  if (getServerUrl()) {
    return httpFetch("/api/note").then((r) => r.text());
  }
  return invoke("get_note");
}

export function putNote(text: string): Promise<void> {
  if (getServerUrl()) {
    return httpFetch("/api/note", {
      method: "PUT",
      headers: { "Content-Type": "text/plain" },
      body: text,
    }).then(() => undefined);
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

// Turn any thrown value into a message. IPC rejections arrive as plain strings (the Rust
// commands return Result<_, String>); JS failures arrive as Error. The one home for that
// decision, next to the boundary that produces them.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
