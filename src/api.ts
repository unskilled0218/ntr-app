// The transport shim: the ONLY file that knows about Tauri (`invoke`, `listen`) or the HTTP
// server (`fetch`, `EventSource`). Every component calls these functions. A saved server
// URL normally selects HTTP; a connection failure selects one effective local destination
// without discarding settings. All reads and writes share that destination and its readiness.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getAllowInvalidCert, getConflictStrategy, getServerUrl } from "./settings";
import { classifyConflict } from "./lib/conflict";

// Task shape — exactly the backend's TaskDto (src-tauri/src/dto.rs), itself the server's shape.
export interface Task {
  id: number;
  list_id?: string;
  completed: boolean;
  completion_date: string | null;
  creation_date: string | null;
  description: string;
  projects: string[];
  contexts: string[];
  tags: Record<string, string>;
  raw: string;
}

export interface HaList { id: string; name: string; is_default: boolean; can_rename: boolean; can_delete: boolean }
export interface HaCatalog { lists: HaList[]; can_create: boolean; pending_move: { operation_id: number; task_id: number; source_list: string; target_list: string; copy_identified: boolean } | null }
export interface TaskRouting { list_id?: string; confirm_move?: boolean; expected_source?: string; expected_raw?: string }

export async function getHaCatalog(context = captureTransport()): Promise<HaCatalog | null> {
  if (!context.url || (await serverCapabilities(context)).task_backend !== "homeassistant") return null;
  const catalog = await httpJson<HaCatalog>("/api/lists", undefined, context);
  requireCurrent(context);
  if (!Array.isArray(catalog.lists) || !catalog.lists.some((list) => list.is_default) || catalog.lists.some((list) => typeof list.id !== "string" || typeof list.name !== "string")) throw new Error("Invalid HA list catalog; routing blocked");
  return catalog;
}

export async function manageHaList(action: "create" | "rename" | "delete", id: string, name: string, expectedName: string, context = captureTransport()): Promise<HaCatalog> {
  requireWritable("tasks", context);
  return httpJson<HaCatalog>(`/api/lists${action === "create" ? "" : `/${encodeURIComponent(id)}`}`, { method: action === "create" ? "POST" : action === "rename" ? "PUT" : "DELETE", body: JSON.stringify({name, confirmed:true, expected_name:expectedName}) }, context);
}
export async function recoverHaMove(action: "abandon" | "reconcile", operationId: number, context = captureTransport()): Promise<HaCatalog> {
  requireWritable("tasks", context);
  return httpJson<HaCatalog>("/api/list-move/recovery", {method:"POST", body:JSON.stringify({action, operation_id:operationId, confirmed:true})}, context);
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
  readonly configuredUrl?: string;
}
let transportGeneration = 0;
let localGeneration = 0;
let fallback = false;
let managed = false;
let initialized = false;
let initializationFailed = false;
let activatedDestination = "";
let ready = { note: false, tasks: false };
let connectionStatus = "";
let reconciliationStatus = "";
let storageError = "";
const transportListeners = new Set<() => void>();
const localWrites = new Set<Promise<unknown>>();
const emitTransport = () => transportListeners.forEach((listener) => listener());
export function subscribeTransport(listener: () => void) {
  transportListeners.add(listener);
  return () => { transportListeners.delete(listener); };
}
export function transportStatus() {
  return [connectionStatus || (managed && !initialized ? "Loading destination" : ""), reconciliationStatus].filter(Boolean).join("; ");
}
export function usingLocalFallback() { return fallback; }
export function canMutate(resource: "note" | "tasks") { return !managed || (initialized && ready[resource]); }
export function needsInitialization() { return !initialized; }
export function finishInitialization(context: TransportContext) {
  if (!isTransportCurrent(context) || initializationFailed) return;
  initialized = true;
  emitTransport();
}
export function markResourceReady(resource: "note" | "tasks", context: TransportContext) {
  if (!isTransportCurrent(context) || ready[resource]) return;
  ready[resource] = true;
  emitTransport();
}
function requireWritable(resource: "note" | "tasks", context: TransportContext) {
  requireCurrent(context);
  if (!canMutate(resource)) throw new Error("Destination is still loading. Choose the action again when ready.");
}
export function startTransportSession() {
  managed = true;
  fallback = false;
  connectionStatus = "";
  storageError = "";
  reconciliationStatus = "";
  return activateTransport(false, true);
}
export function endTransportSession() {
  managed = false;
  fallback = false;
  transportGeneration++;
}
export function reconnectTransport() {
  fallback = false;
  connectionStatus = "";
  reconciliationStatus = "";
  return activateTransport(false, true);
}
function enterFallback(context: TransportContext) {
  if (!isTransportCurrent(context) || !context.url || fallback) return;
  fallback = true;
  connectionStatus = "Server unavailable; using local files";
  activateTransport();
}
// Register before dispatch. A generation change prevents new admissions; draining
// these promises orders native commits, not merely their UI continuations.
function localWrite<T>(command: string, args: Record<string, unknown>, context = captureTransport()): Promise<T> {
  requireCurrent(context);
  const pending = Promise.resolve().then(() => invoke<T>(command, args));
  return trackLocalWrite(pending);
}
function trackLocalWrite<T>(pending: Promise<T>): Promise<T> {
  localWrites.add(pending);
  void pending.catch((error) => { storageError = `Local storage write failed: ${errMsg(error)}`; })
    .finally(() => localWrites.delete(pending));
  return pending;
}
async function drainLocalWrites(context: TransportContext) {
  if (localWrites.size) {
    connectionStatus = "Waiting for local storage";
    emitTransport();
    await Promise.allSettled([...localWrites]);
  }
  requireCurrent(context);
  connectionStatus = [fallback ? "Server unavailable; using local files" : "", storageError].filter(Boolean).join("; ");
  emitTransport();
}
async function localRead<T>(command: string, args: Record<string, unknown> | undefined, context: TransportContext): Promise<T> {
  if (localWrites.size) await drainLocalWrites(context);
  requireCurrent(context);
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
}
const clientSessionId = crypto.randomUUID();
export function destination(context: TransportContext): string {
  return context.url ? `server:${context.url}` : `local:${context.localGeneration}`;
}
export function captureTransport(): TransportContext {
  const configuredUrl = getServerUrl();
  return Object.freeze({ generation: transportGeneration, localGeneration, configuredUrl, url: fallback ? "" : configuredUrl, allowInvalidCert: getAllowInvalidCert() });
}
export function activateTransport(storageChanged = false, forceInitialization = false): TransportContext {
  transportGeneration++;
  if (storageChanged) localGeneration++;
  const context = captureTransport();
  if (forceInitialization || activatedDestination !== destination(context)) {
    initialized = false;
    initializationFailed = false;
    ready = { note: false, tasks: false };
  }
  activatedDestination = destination(context);
  emitTransport();
  return context;
}
export function isTransportCurrent(context: TransportContext): boolean {
  return context.generation === transportGeneration && (context.configuredUrl ?? context.url) === getServerUrl()
    && context.url === (fallback ? "" : getServerUrl())
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

class HttpStatusError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface ServerCapabilities { task_backend: "file" | "homeassistant"; raw_task_replace: boolean }
let capabilitySession: { generation: number; url: string; allowInvalidCert: boolean; promise: Promise<ServerCapabilities> } | undefined;
async function serverCapabilities(context: TransportContext): Promise<ServerCapabilities> {
  requireCurrent(context);
  if (capabilitySession?.generation === context.generation && capabilitySession.url === context.url && capabilitySession.allowInvalidCert === context.allowInvalidCert) return capabilitySession.promise;
  const promise = (async () => {
    let value: unknown;
    try { value = await httpJson<unknown>("/api/capabilities", undefined, context); }
    catch (error) {
      if (error instanceof HttpStatusError && error.status === 404) return { task_backend: "file", raw_task_replace: true } as const;
      throw error;
    }
    requireCurrent(context);
    if (!value || typeof value !== "object" || !("task_backend" in value) || !("raw_task_replace" in value)
      || !["file", "homeassistant"].includes(String(value.task_backend)) || typeof value.raw_task_replace !== "boolean"
      || value.raw_task_replace !== (value.task_backend === "file")) throw new Error("Invalid server capabilities; no reconciliation writes were made.");
    return value as ServerCapabilities;
  })();
  capabilitySession = { generation: context.generation, url: context.url, allowInvalidCert: context.allowInvalidCert, promise };
  return promise;
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
    if (!res.ok) {
      const status = `${res.status} ${res.status_text}`.trim();
      const uncertainTaskWrite = method !== "GET" && resource === "tasks" && (res.status === 409 || res.status === 504);
      let detail = "";
      if (path.startsWith("/api/lists") || path === "/api/list-move/recovery") {
        try { const error = JSON.parse(res.body).error; if (typeof error === "string") detail = `. ${error.slice(0, 1000)}`; } catch { /* Retain status for non-JSON proxy errors. */ }
      }
      throw new HttpStatusError(res.status, uncertainTaskWrite ? `${status}. Task write outcome is uncertain; reconnect to read actual state before retrying.` : status + detail);
    }
    response = res.body;
    return res.body;
  } catch (error) {
    if (method === "GET" && error && typeof error === "object" && "kind" in error && error.kind === "connection") enterFallback(context);
    throw error;
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
  return (async () => {
    if (path === "/api/raw" && !(await serverCapabilities(context)).raw_task_replace) throw new Error("HA tasks cannot be replaced from a local task file.");
    await serverFetch(path, "PUT", text, "text/plain", context);
  })();
}

// --- Local backup helpers (server mode only, best-effort) ---

async function backupNoteLocally(text: string, context: TransportContext): Promise<void> {
  try {
    await localWrite("put_note", { text }, context);
  } catch (e) {
    console.warn("local note backup failed:", e);
  }
}

async function backupLabelsLocally(labels: Labels, context: TransportContext): Promise<void> {
  try {
    await localWrite("put_labels", { labels }, context);
  } catch (e) {
    console.warn("local labels backup failed:", e);
  }
}

async function backupTasksLocally(context = captureTransport()): Promise<void> {
  try {
    // /api/raw is the server store's own todo.txt render — the single canonical
    // "server tasks as text" source, also used by the conflict reconcile path.
    const raw = await httpText("/api/raw", context);
    if (isTransportCurrent(context)) await localWrite("put_raw", { text: raw }, context);
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
  return localRead("list_tasks", {
    completed: filter.completed ?? null,
    project: filter.project ?? null,
    context: filter.context ?? null,
  }, context);
}

export async function createTask(text: string, routing?: TaskRouting): Promise<Task> {
  const context = captureTransport();
  requireWritable("tasks", context);
  if (!context.url && routing) throw new Error("HA list routing is unavailable for local files");
  if (context.url) {
    const task = await httpJson<Task>("/api/tasks", {
      method: "POST",
      body: JSON.stringify({ text, ...routing }),
    }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return localWrite("create_task", { text }, context);
}

export async function updateTask(id: number, text: string, context = captureTransport(), routing?: TaskRouting): Promise<Task> {
  requireWritable("tasks", context);
  if (!context.url && routing) throw new Error("HA list routing is unavailable for local files");
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}`, {
      method: "PUT",
      body: JSON.stringify({ text, ...routing }),
    }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return localWrite("update_task", { id, text }, context);
}

export async function completeTask(id: number): Promise<Task> {
  const context = captureTransport();
  requireWritable("tasks", context);
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}/complete`, { method: "POST" }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return localWrite("complete_task", { id }, context);
}

export async function uncompleteTask(id: number): Promise<Task> {
  const context = captureTransport();
  requireWritable("tasks", context);
  if (context.url) {
    const task = await httpJson<Task>(`/api/tasks/${id}/uncomplete`, { method: "POST" }, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return task;
  }
  return localWrite("uncomplete_task", { id }, context);
}

export async function deleteTask(id: number): Promise<void> {
  const context = captureTransport();
  requireWritable("tasks", context);
  if (context.url) {
    await serverFetch(`/api/tasks/${id}`, "DELETE", undefined, undefined, context);
    if (isTransportCurrent(context)) await backupTasksLocally(context);
    return;
  }
  return localWrite("delete_task", { id }, context);
}

export function getNote(context = captureTransport()): Promise<string> {
  requireCurrent(context);
  if (context.url) {
    return httpText("/api/note", context);
  }
  return localRead("get_note", undefined, context);
}

export async function putNote(text: string, context = captureTransport()): Promise<void> {
  requireWritable("note", context);
  if (context.url) {
    await httpPutText("/api/note", text, context);
    if (isTransportCurrent(context)) await backupNoteLocally(text, context);
    return;
  }
  return localWrite("put_note", { text }, context);
}

export function getLabels(context = captureTransport()): Promise<Labels> {
  requireCurrent(context);
  if (context.url) {
    return httpJson<Labels>("/api/labels", undefined, context);
  }
  return localRead("get_labels", undefined, context);
}

export async function putLabels(labels: Labels, context = captureTransport()): Promise<void> {
  requireWritable("tasks", context);
  if (context.url) {
    await serverFetch("/api/labels", "PUT", JSON.stringify(labels), "application/json", context);
    if (isTransportCurrent(context)) await backupLabelsLocally(labels, context);
    return;
  }
  return localWrite("put_labels", { labels }, context);
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
  writeLocal(text: string, context: TransportContext): Promise<void>;
  writeServer(text: string, context: TransportContext): Promise<void>;
}

const CONFLICT_IO: Record<ConflictResource, ResourceIO> = {
  note: {
    readLocal: () => invoke("get_note"),
    readServer: (context) => httpText("/api/note", context),
    writeLocal: (text, context) => localWrite("put_note", { text }, context),
    writeServer: (text, context) => httpPutText("/api/note", text, context),
  },
  tasks: {
    // /api/raw is the server store's own todo.txt render, byte-for-byte the format
    // local get_raw returns — so equal content compares equal, no join/newline logic.
    readLocal: () => invoke("get_raw"),
    readServer: (context) => httpText("/api/raw", context),
    writeLocal: (text, context) => localWrite("put_raw", { text }, context),
    writeServer: (text, context) => httpPutText("/api/raw", text, context),
  },
};

// "server" writes the server copy down to the local file; "local" pushes the
// local copy up to the server. Either way both sides end up identical.
const conflictContexts = new WeakMap<Conflict, TransportContext>();
function applyChoice(c: Conflict, choice: ConflictChoice, context = conflictContexts.get(c) ?? captureTransport()): Promise<void> {
  requireCurrent(context);
  const io = CONFLICT_IO[c.resource];
  return choice === "server" ? io.writeLocal(c.server, context) : io.writeServer(c.local, context);
}

// Reconcile the local todo.txt / Note.md with a server's copies. Called on app
// open and after connecting. For each resource: identical copies are left alone;
// a difference with an empty local copy adopts the server silently; a real
// difference is resolved per the configured strategy ("server"/"local" auto-apply,
// "ask" is returned for the UI to prompt). Discover both resources before writing;
// stop application on failure and retain partial outcomes. Local mode only drains writes.
export async function reconcileWithServer(context = captureTransport(), signal?: AbortSignal): Promise<Conflict[]> {
  const current = () => isTransportCurrent(context) && !signal?.aborted;
  if (!current()) return [];
  await drainLocalWrites(context);
  if (!current()) return [];
  if (!context.url) { initialized = true; return []; }
  const strategy = getConflictStrategy();
  const conflicts: Conflict[] = [];
  const discovered: { conflict: Conflict; verdict: ReturnType<typeof classifyConflict> }[] = [];
  let haTasks = false;
  // No writes until every discovery read succeeds. In particular, a successful
  // note read must not overwrite local text before the task GET can fail.
  try {
    haTasks = (await serverCapabilities(context)).task_backend === "homeassistant";
    if (!current()) return [];
    for (const resource of ["note", "tasks"] as ConflictResource[]) {
      const io = CONFLICT_IO[resource];
      const [local, server] = await Promise.all([io.readLocal(), io.readServer(context)]);
      if (!current()) return [];
      discovered.push({ conflict: { resource, local, server }, verdict: classifyConflict(local, server) });
    }
  } catch (error) {
    if (!current() && !(error && typeof error === "object" && "kind" in error && error.kind === "connection")) return [];
    if (current()) {
      initializationFailed = true;
      connectionStatus = `Could not initialize server: ${errMsg(error)}`;
      emitTransport();
    }
    throw error;
  }
  const outcomes: string[] = [];
  for (const { conflict, verdict } of discovered) {
    const resource = conflict.resource;
    let choice: ConflictChoice | undefined;
    try {
      if (!current()) return [];
      if (verdict === "in-sync") { outcomes.push(`${resource}: unchanged`); continue; }
      conflictContexts.set(conflict, context);
      if (resource === "tasks" && haTasks) {
        choice = "server";
      } else if (verdict === "adopt-server") {
        choice = "server";
      } else if (strategy === "ask") {
        conflicts.push(conflict);
        outcomes.push(`${resource}: awaiting choice`);
      } else {
        choice = strategy;
      }
      if (choice) {
        await applyChoice(conflict, choice, context);
        outcomes.push(`${resource}: applied ${choice} copy`);
      }
    } catch (e) {
      if (!current()) return [];
      initializationFailed = true;
      const remaining = discovered.slice(discovered.findIndex((item) => item.conflict === conflict) + 1)
        .map((item) => `${item.conflict.resource}: not applied`);
      reconciliationStatus = `Reconciliation stopped; ${[...outcomes, `${resource}: outcome unknown (${choice ?? "no write"})`, ...remaining].join("; ")}. ${errMsg(e)}. Connect to recheck.`;
      emitTransport();
      throw e;
    }
  }
  if (current()) initialized = !conflicts.length;
  return conflicts;
}

// Apply the user's dialog choice for one conflict. "server" overwrites the local
// file with the server copy; "local" pushes the local copy to the server.
export async function resolveConflict(c: Conflict, choice: ConflictChoice): Promise<void> {
  if (managed && initializationFailed) throw new Error("Connect to recheck the uncertain reconciliation before choosing again.");
  try { await applyChoice(c, choice); }
  catch (error) {
    initialized = false;
    initializationFailed = true;
    reconciliationStatus = `${c.resource}: outcome unknown (${choice}). ${errMsg(error)}. Connect to recheck.`;
    emitTransport();
    throw error;
  }
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
  const earlier = [...localWrites];
  const work = trackLocalWrite(Promise.allSettled(earlier).then(() => invoke("set_data_dir", { dir })));
  activateTransport(false, true);
  try { await work; }
  finally { activateTransport(true); }
}

// Turn any thrown value into a message. IPC rejections arrive as plain strings (the Rust
// commands return Result<_, String>); JS failures arrive as Error. The one home for that
// decision, next to the boundary that produces them.
export function errMsg(e: unknown): string {
  return e && typeof e === "object" && "message" in e ? String(e.message) : String(e);
}
