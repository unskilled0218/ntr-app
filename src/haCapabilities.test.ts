import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { captureTransport, createTask, endTransportSession, markResourceReady, reconcileWithServer, resolveConflict, startTransportSession, usingLocalFallback } from "./api";
import { setConflictStrategy, type ConflictStrategy } from "./settings";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let capabilities: unknown;
let status: number;
let taskStatus: number;
let calls: string[];
let raw: string;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("ntr.serverUrl", "https://ntr.test");
  capabilities = { task_backend: "homeassistant", raw_task_replace: false };
  status = 200; taskStatus = 200; calls = []; raw = "local task\n";
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === "get_note") return "same note";
    if (command === "get_raw") return raw;
    if (command === "put_raw") { calls.push("local backup"); raw = (args as { text: string }).text; return; }
    if (command === "server_fetch") {
      const req = (args as { req: { url: string; method: string } }).req;
      const path = new URL(req.url).pathname;
      calls.push(`${req.method} ${path}`);
      const body = path === "/api/capabilities" ? JSON.stringify(capabilities) : path === "/api/note" ? "same note" : "HA task\n";
      const code = path === "/api/capabilities" ? status : path.startsWith("/api/tasks") && req.method !== "GET" ? taskStatus : 200;
      return { ok: code === 200, status: code, status_text: "Failure", body };
    }
  });
  startTransportSession();
});
afterEach(() => { endTransportSession(); localStorage.clear(); });

it.each(["ask", "local", "server"])("HA reconnect adopts HA tasks without upload under %s strategy", async (strategy) => {
  setConflictStrategy(strategy as ConflictStrategy);
  expect(await reconcileWithServer()).toEqual([]);
  expect(raw).toBe("HA task\n");
  expect(calls).not.toContain("PUT /api/raw");
  expect(calls[0]).toBe("GET /api/capabilities");
});

it.each([null, [], {}, { task_backend: "homeassistant", raw_task_replace: true }])("rejects malformed capabilities without writing: %j", async (value) => {
  capabilities = value;
  await expect(reconcileWithServer()).rejects.toThrow("Invalid server capabilities");
  expect(calls).toEqual(["GET /api/capabilities"]);
  expect(raw).toBe("local task\n");
});

it.each([401, 502, 503, 504])("does not downgrade or switch destination on capability HTTP %s", async (code) => {
  status = code;
  await expect(reconcileWithServer()).rejects.toThrow(`${code}`);
  expect(calls).toEqual(["GET /api/capabilities"]);
  expect(usingLocalFallback()).toBe(false);
});

it("rejects a direct local task conflict upload before sending a PUT", async () => {
  await expect(resolveConflict({ resource: "tasks", local: "local", server: "HA" }, "local")).rejects.toThrow("HA tasks cannot be replaced");
  expect(calls).toEqual(["GET /api/capabilities"]);
});

it("404 capability discovery retains older file-server reconciliation", async () => {
  status = 404;
  setConflictStrategy("local");
  await reconcileWithServer(captureTransport());
  expect(calls).toContain("PUT /api/raw");
});

it("does not reuse another destination's capabilities before React activation", async () => {
  status = 404;
  await reconcileWithServer();
  localStorage.setItem("ntr.serverUrl", "https://other-ntr.test");
  status = 200;
  calls = [];
  setConflictStrategy("local");
  await reconcileWithServer(captureTransport());
  expect(calls[0]).toBe("GET /api/capabilities");
  expect(calls).not.toContain("PUT /api/raw");
});

it.each([409, 504])("explains uncertain task HTTP %s without replay or local fallback", async (code) => {
  await reconcileWithServer();
  markResourceReady("tasks", captureTransport());
  calls = []; taskStatus = code;
  await expect(createTask("one submission")).rejects.toThrow(/outcome is uncertain; reconnect/);
  expect(calls).toEqual(["POST /api/tasks"]);
  expect(usingLocalFallback()).toBe(false);
});
