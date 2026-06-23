// The transport shim: the ONLY file that knows about Tauri (`invoke`, `listen`). Every component
// calls these functions, so a future "with server" mode swaps this file alone. Mirrors the
// helper layer of web/app.js (api()/fetchNote()/putNote()), with the HTTP routes replaced by the
// Rust commands registered in src-tauri/src/lib.rs.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

export function listTasks(filter: TaskFilter): Promise<Task[]> {
  return invoke("list_tasks", {
    completed: filter.completed ?? null,
    priority: filter.priority ?? null,
    project: filter.project ?? null,
    context: filter.context ?? null,
  });
}

export function createTask(text: string): Promise<Task> {
  return invoke("create_task", { text });
}

export function updateTask(id: number, text: string): Promise<Task> {
  return invoke("update_task", { id, text });
}

export function completeTask(id: number): Promise<Task> {
  return invoke("complete_task", { id });
}

export function uncompleteTask(id: number): Promise<Task> {
  return invoke("uncomplete_task", { id });
}

export function deleteTask(id: number): Promise<void> {
  return invoke("delete_task", { id });
}

export function getNote(): Promise<string> {
  return invoke("get_note");
}

export function putNote(text: string): Promise<void> {
  return invoke("put_note", { text });
}

// Subscribe to the backend's `change` stream. The callback receives the payload token
// (CHANGE_TASKS / CHANGE_NOTE). Returns the unlisten function.
export function onChange(handler: (kind: string) => void): Promise<UnlistenFn> {
  return listen<string>(CHANGE_EVENT, (e) => handler(e.payload));
}

// Turn any thrown value into a message. IPC rejections arrive as plain strings (the Rust
// commands return Result<_, String>); JS failures arrive as Error. The one home for that
// decision, next to the boundary that produces them.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
