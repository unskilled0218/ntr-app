// The transport shim: the ONLY file that knows about Tauri (`invoke`, `listen`) or the HTTP
// server (`fetch`, `EventSource`). Every component calls these functions. When a server URL
// is configured via `settings.ts`, calls go to the HTTP API; otherwise they use local Tauri
// commands. Mirrors the helper layer of web/app.js (api()/fetchNote()/putNote()).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getAllowInvalidCert, getConflictStrategy, getServerUrl } from "./settings";
import { classifyConflict } from "./lib/conflict";

// Task shape — exactly the backend's TaskDto (src-tauri/src/dto.rs), itself the server's shape.
export interface Task {
  id: number;
  completed: boolean;
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
  project?: string | null;
  context?: string | null;
}

export interface Labels {
  project: string[];
  context: string[];
}

// Live-update event name + payload tokens. These mirror the Rust `Change` enum / CHANGE_EVENT in
// src-tauri/src/watch.rs — keep the two ends in sync. A typo here fails silently (no event fires).
export const CHANGE_EVENT = "change";
export const CHANGE_TASKS = "tasks";
export const CHANGE_NOTE = "note";
export const SERVER_LIVE_EVENT = "server-live";

export interface Mutation {
  resource: "tasks" | "note";
  path: string;
  method: string;
  body?: string;
  context: TransportContext;
}
const mutationObservers = new Set<(mutation: Mutation) => (response?: string) => void>();
export function observeMutations(observer: (mutation: Mutation) => (response?: string) => void) {
  mutationObservers.add(observer);
  return () => { mutationObservers.delete(observer); };
}

// One activation owns its reads and deferred writes. A settings change invalidates
// it synchronously, before React effects or old promise continuations can run.
export interface TransportContext {
  readonly generation: number;
  readonly localGeneration: number;
  readonly url: string;
  readonly allowInvalidCert: boolean;
}
let transportGeneration = 0;
let localGeneration = 0;
const clientSessionId = crypto.randomUUID();
export function destination(context: TransportContext): string {
  return context.url ? `server:${context.url}` : `local:${context.localGeneration}`;
}
export function captureTransport(): TransportContext {
  return Object.freeze({ generation: transportGeneration, localGeneration, url: getServerUrl(), allowInvalidCert: getAllowInvalidCert() });
}
export function activateTransport(storageChanged = false): TransportContext {
  transportGeneration++;
  if (storageChanged) localGeneration++;
  return captureTransport();
}
export function isTransportCurrent(context: TransportContext): boolean {
  return context.generation === transportGeneration && context.url === getServerUrl()
    && context.allowInvalidCert === getAllowInvalidCert();
}
function requireCurrent(context: TransportContext) {
  if (!isTransportCurrent(context)) throw new Error("Connection changed");
}

// --- HTTP helpers (server mode only) ---
//
// Server-mode requests go through the Rust `server_fetch` command, not a webview `fetch`. A
// native request is not subject to CORS and can be told (via the allow-invalid-cert setting) to
// accept a self-signed certificate, so the app reaches an HTTPS reverse proxy like
// https://ntr.lan that the webview's own fetch cannot. See src-tauri/src/http.rs.

interface HttpResponse {
  status: number;
  ok: boolean;
  status_text: string;
  body: string;
}

// The single server-mode request primitive. Throws on a non-2xx status to preserve the old
// httpFetch contract — callers and tests rely on the thrown "<status> <statusText>" message.
async function serverFetch(
  path: string,
  method = "GET",
  body?: string,
  contentType?: string,
  context = captureTransport(),
): Promise<string> {
  requireCurrent(context);
  const resource = path === "/api/note" ? "note" : path.startsWith("/api/tasks") || path === "/api/raw" ? "tasks" : null;
  const completions = method !== "GET" && resource
    ? [...mutationObservers].map((observer) => observer({ resource, path, method, body, context })) : [];
  let response: string | undefined;
  try {
    const res = await invoke<HttpResponse>("server_fetch", {
      req: {
        url: context.url + path,
        method,
        body: body ?? null,
        contentType: contentType ?? null,
        allowInvalidCert: context.allowInvalidCert,
        clientId: method === "GET" ? null : clientSessionId,
      },
    });
    if (!res.ok) throw new Error(`${res.status} ${res.status_text}`.trim());
    response = res.body;
    return res.body;
  } finally { completions.forEach((complete) => complete(response)); }
}

async function httpJson<T>(path: string, init?: { method?: string; body?: string }, context = captureTransport()): Promise<T> {
  // A JSON body is the only case that needs a Content-Type; bodyless GETs send none (matching
  // the old behaviour, where GETs carried no headers).
  const body = await serverFetch(
    path,
    init?.method ?? "GET",
    init?.body,
    init?.body != null ? "application/json" : undefined,
    context,
  );
  return JSON.parse(body) as T;
}

// The note and todo.txt endpoints exchange plain text. These two helpers are the
// single home for "GET/PUT text at a server path", shared by the user-write path
// (getNote/putNote) and the conflict path (CONFLICT_IO) so they cannot drift.
function httpText(path: string, context = captureTransport()): Promise<string> {
  return serverFetch(path, "GET", undefined, undefined, context);
}

function httpPutText(path: string, text: string, context = captureTransport()): Promise<void> {
  return serverFetch(path, "PUT", text, "text/plain", context).then(() => {});
}

// --- Local backup helpers (server mode only, best-effort) ---

async function backupNoteLocally(text: string): Promise<void> {
  try {
    await invoke("put_note", { text });
  } catch (e) {
    console.warn("local note backup failed:", e);
  }
}

async function backupLabelsLocally(labels: Labels): Promise<void> {
  try {
    await invoke("put_labels", { labels });
  } catch (e) {
    console.warn("local labels backup failed:", e);
  }
}

async function backupTasksLocally(context = captureTransport()): Promise<void> {
  try {
    // /api/raw is the server store's own todo.txt render — the single canonical
    // "server tasks as text" source, also used by the conflict reconcile path.
    const raw = await httpText("/api/raw", context);
    if (isTransportCurrent(context)) await invoke("put_raw", { text: raw });
  } catch (e) {
    console.warn("local task backup failed:", e);
  }
}

// --- Exported API ---

export function listTasks(filter: TaskFilter, context = captureTransport()): Promise<Task[]> {
  requireCurrent(context);
  if (context.url) {
    const params = new URLSearchParams();
    if (filter.completed != null) params.set("completed", String(filter.completed));
    if (filter.project != null) params.set("project", filter.project);
    if (filter.context != null) params.set("context", filter.context);
    const qs = params.toString();
    return httpJson<Task[]>("/api/tasks" + (qs ? "?" + qs : ""), undefined, context);
  }
  return invoke("list_tasks", {
    completed: filter.completed ?? null,
    project: filter.project ?? null,
    context: filter.context ?? null,
  });
}

export async function createTask(text: string): Promise<Task> {
  const context = captureTransport();
  if (context.url) {
    const task = await httpJson<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ text }),
    }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return invoke("create_task", { text });
}

export async function updateTask(id: number, text: string): Promise<Task> {
  const context = captureTransport();
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text }),
    }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return invoke("update_task", { id, text });
}

export async function completeTask(id: number): Promise<Task> {
  const context = captureTransport();
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}/complete`, { method: "POST" }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return invoke("complete_task", { id });
}

export async function uncompleteTask(id: number): Promise<Task> {
  const context = captureTransport();
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}/uncomplete`, { method: "POST" }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return invoke("uncomplete_task", { id });
}

export async function deleteTask(id: number): Promise<void> {
  const context = captureTransport();
  if (context.url) {
    await serverFetch(`/api/tasks/${id}`, "DELETE", undefined, undefined, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return;
  }
  return invoke("delete_task", { id });
}

export function getNote(context = captureTransport()): Promise<string> {
  requireCurrent(context);
  if (context.url) {
    return httpText("/api/note", context);
  }
  return invoke("get_note");
}

export async function putNote(text: string, context = captureTransport()): Promise<void> {
  requireCurrent(context);
  if (context.url) {
    await httpPutText("/api/note", text, context);
    if (isTransportCurrent(context)) await backupNoteLocally(text);
    return;
  }
  return invoke("put_note", { text });
}

export function getLabels(context = captureTransport()): Promise<Labels> {
  requireCurrent(context);
  if (context.url) {
    return httpJson<Labels>("/api/labels", undefined, context);
  }
  return invoke("get_labels");
}

export async function putLabels(labels: Labels, context = captureTransport()): Promise<void> {
  requireCurrent(context);
  if (context.url) {
    await serverFetch("/api/labels", "PUT", JSON.stringify(labels), "application/json", context);
    if (isTransportCurrent(context)) await backupLabelsLocally(labels);
    return;
  }
  return invoke("put_labels", { labels });
}

interface ServerLiveEvent {
  connectionId: string;
  kind: "connected" | "tasks" | "note";
}
let subscriptionGeneration = 0;
let activeCleanup: (() => void) | undefined;
let lifecycle: Promise<unknown> = Promise.resolve();
function transition(action: () => Promise<unknown>): Promise<unknown> {
  const next = lifecycle.then(action);
  lifecycle = next.catch(() => {}); // one failed command must not poison later setup
  return next;
}

// The listener exists before connect. Cancellation also works while listen/connect
// is pending, and every native teardown is scoped to its original owner.
export async function onChange(
  handler: (kind: string) => void,
  options: { signal?: AbortSignal; onConnected?: () => void } = {},
): Promise<UnlistenFn> {
  activeCleanup?.();
  const generation = ++subscriptionGeneration;
  const context = captureTransport();
  const connectionId = crypto.randomUUID();
  let ended = false;
  let started = false;
  let unlisten: UnlistenFn | undefined;
  const current = () => !ended && generation === subscriptionGeneration && isTransportCurrent(context);
  const cleanup = () => {
    if (ended) return;
    ended = true;
    unlisten?.();
    options.signal?.removeEventListener("abort", cleanup);
    if (started) {
      void transition(() => invoke("server_disconnect", { connectionId }))
        .catch((error) => console.warn("live disconnect failed:", error));
    }
    if (activeCleanup === cleanup) activeCleanup = undefined;
  };
  activeCleanup = cleanup;
  options.signal?.addEventListener("abort", cleanup, { once: true });
  if (options.signal?.aborted) cleanup();
  try {
    if (!context.url) await lifecycle;
    if (!current()) { cleanup(); return cleanup; }
    unlisten = context.url
      ? await listen<ServerLiveEvent>(SERVER_LIVE_EVENT, ({ payload }) => {
        if (!current() || payload.connectionId !== connectionId) return;
        if (payload.kind === "connected") options.onConnected?.();
        else if (payload.kind === CHANGE_TASKS || payload.kind === CHANGE_NOTE) handler(payload.kind);
      })
      : await listen<string>(CHANGE_EVENT, ({ payload }) => {
        if (current()) handler(payload);
      });
    if (!current()) { unlisten(); cleanup(); return cleanup; }
    if (context.url) {
      await transition(async () => {
        if (!current()) return;
        started = true;
        await invoke("server_connect", {
          connectionId, url: context.url + "/api/events", allowInvalidCert: context.allowInvalidCert, clientId: clientSessionId,
        });
      });
    }
    if (!current()) cleanup();
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
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
  readServer(context: TransportContext): Promise<string>;
  writeLocal(text: string): Promise<void>;
  writeServer(text: string, context: TransportContext): Promise<void>;
}

const CONFLICT_IO: Record<ConflictResource, ResourceIO> = {
  note: {
    readLocal: () => invoke("get_note"),
    readServer: (context) => httpText("/api/note", context),
    writeLocal: (text) => invoke("put_note", { text }),
    writeServer: (text, context) => httpPutText("/api/note", text, context),
  },
  tasks: {
    // /api/raw is the server store's own todo.txt render, byte-for-byte the format
    // local get_raw returns — so equal content compares equal, no join/newline logic.
    readLocal: () => invoke("get_raw"),
    readServer: (context) => httpText("/api/raw", context),
    writeLocal: (text) => invoke("put_raw", { text }),
    writeServer: (text, context) => httpPutText("/api/raw", text, context),
  },
};

// "server" writes the server copy down to the local file; "local" pushes the
// local copy up to the server. Either way both sides end up identical.
const conflictContexts = new WeakMap<Conflict, TransportContext>();
function applyChoice(c: Conflict, choice: ConflictChoice, context = conflictContexts.get(c) ?? captureTransport()): Promise<void> {
  requireCurrent(context);
  const io = CONFLICT_IO[c.resource];
  return choice === "server" ? io.writeLocal(c.server) : io.writeServer(c.local, context);
}

// Reconcile the local todo.txt / Note.md with a server's copies. Called on app
// open and after connecting. For each resource: identical copies are left alone;
// a difference with an empty local copy adopts the server silently; a real
// difference is resolved per the configured strategy ("server"/"local" auto-apply,
// "ask" is returned for the UI to prompt). Best-effort: a failure on one resource
// is logged and does not block the other. No-op (returns []) in local mode.
export async function reconcileWithServer(context = captureTransport(), signal?: AbortSignal): Promise<Conflict[]> {
  const current = () => isTransportCurrent(context) && !signal?.aborted;
  if (!context.url || !current()) return [];
  const strategy = getConflictStrategy();
  const conflicts: Conflict[] = [];
  for (const resource of ["note", "tasks"] as ConflictResource[]) {
    try {
      if (!current()) return [];
      const io = CONFLICT_IO[resource];
      const [local, server] = await Promise.all([io.readLocal(), io.readServer(context)]);
      if (!current()) return [];
      const verdict = classifyConflict(local, server);
      if (verdict === "in-sync") continue;
      const conflict: Conflict = { resource, local, server };
      conflictContexts.set(conflict, context);
      if (verdict === "adopt-server") {
        await applyChoice(conflict, "server", context);
      } else if (strategy === "ask") {
        conflicts.push(conflict);
      } else {
        await applyChoice(conflict, strategy, context); // narrowed to "server" | "local"
      }
    } catch (e) {
      if (!current()) return [];
      console.warn(`reconcile ${resource} failed:`, e);
    }
  }
  return conflicts;
}

// Apply the user's dialog choice for one conflict. "server" overwrites the local
// file with the server copy; "local" pushes the local copy to the server.
export async function resolveConflict(c: Conflict, choice: ConflictChoice): Promise<void> {
  await applyChoice(c, choice);
}

export function getDataDir(): Promise<string> {
  return invoke("get_data_dir");
}

export function pickDataDir(): Promise<string | null> {
  return invoke("pick_data_dir");
}

export type StorageKind = "path" | "saf";

export function getStorageKind(): Promise<StorageKind> {
  return invoke("storage_kind");
}

export async function setDataDir(dir: string): Promise<void> {
  await invoke("set_data_dir", { dir });
  activateTransport(true);
}

// Turn any thrown value into a message. IPC rejections arrive as plain strings (the Rust
// commands return Result<_, String>); JS failures arrive as Error. The one home for that
// decision, next to the boundary that produces them.
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
