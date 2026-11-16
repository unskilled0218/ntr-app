// Actual client serializer against the Rust HA adapter and a disposable trusted-TLS HA fixture.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import https from "node:https";
import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { once } from "node:events";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const serverRoot = resolve(process.env.NTR_SERVER_SOURCE ?? join(root, "../server"));
const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "ntr-ha-contract-"));
let fake;
let server;
try {
  execFileSync("cargo", ["build", "--locked"], { cwd: serverRoot, stdio: "inherit" });
  await build({ configFile: false, root, logLevel: "error", build: {
    outDir: join(dir, "client"), emptyOutDir: false,
    lib: { entry: { labels: join(root, "src/labels.ts"), listWire: join(root, "src/lib/listWire.ts") }, formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
  } });
  const { composeEditedTask, bareDescription } = await import(pathToFileURL(join(dir, "client/labels.mjs")));
  const { taskFromWire } = await import(pathToFileURL(join(dir, "client/listWire.mjs")));
  fake = spawn("python3", [join(serverRoot, "tests/fixtures/fake_ha.py"), dir], { stdio: ["ignore", "pipe", "inherit"] });
  const lines = createInterface({ input: fake.stdout });
  const [port] = await Promise.race([
    once(lines, "line"),
    once(fake, "exit").then(() => { throw new Error("Fake HA exited before TLS fixture readiness; check Python 3 and OpenSSL."); }),
  ]);
  lines.close();
  const ca = await readFile(join(dir, "ca.pem"));
  const control = (value) => new Promise((resolve, reject) => {
    const request = https.request(`https://localhost:${port}/control`, { ca, method: value ? "POST" : "GET", headers: { "content-type": "application/json" } }, (response) => {
      let text = "";
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
    });
    request.on("error", reject);
    request.end(value ? JSON.stringify(value) : undefined);
  });
  const { writeFile } = await import("node:fs/promises");
  await writeFile(join(dir, "token"), "fixture-secret");
  await writeFile(join(dir, "old-tasks.txt"), "do not migrate\n");
  const socket = createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const ntrPort = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${ntrPort}`;
  const executable = resolve(process.env.CARGO_TARGET_DIR ?? join(serverRoot, "target"), "debug/my-ntr-server");
  const env = { ...process.env, HOST: "127.0.0.1", PORT: String(ntrPort), TASK_BACKEND: "homeassistant", HA_URL: `https://localhost:${port}`, HA_TODO_ENTITY: "todo.fixture", HA_TOKEN_FILE: join(dir, "token"), HA_CA_FILE: join(dir, "ca.pem"), HA_METADATA_FILE: join(dir, "metadata.json"), TODO_FILE: join(dir, "old-tasks.txt"), NOTE_FILE: join(dir, "Note.md"), LABELS_FILE: join(dir, "labels.json") };
  async function start() {
    server = spawn(executable, [], { env, stdio: ["ignore", "pipe", "inherit"] });
    const ready = createInterface({ input: server.stdout });
    await Promise.race([once(ready, "line"), once(server, "exit").then(() => { throw new Error("ntr exited before readiness"); })]);
    ready.close();
  }
   const request = async (path, method = "GET", text, routing = {}) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ text, ...routing }) });
    assert.ok(response.ok, `${method} ${path}: ${await response.clone().text()}`);
     if (response.status === 204) return null;
     const value = await response.json();
     return /^\/api\/tasks(?:\/|$)/.test(path) ? (Array.isArray(value) ? value.map(taskFromWire) : taskFromWire(value)) : value;
  };
  await start();
  const created = await request("/api/tasks", "POST", "2026-11-01 task +work due:2026-11-16T23:00:00-05:00");
  let state = await control();
  state.items[0].status = "completed";
  state.items[0].description = "**HA description**\nretained";
  await control({ items: state.items });
  const unknown = await request(`/api/tasks/${created.id}`);
  assert.equal(unknown.completed, true);
  assert.equal(unknown.creation_date, null);
  assert.equal(unknown.completion_date, null);
   const description = bareDescription(unknown.description, unknown.lists, unknown.contexts, unknown.tags);
   const text = composeEditedTask(unknown, { description: description + " edited", list: "work", due: unknown.tags.due }, "2026-11-15");
  const edited = await request(`/api/tasks/${created.id}`, "PUT", text);
  assert.equal(edited.completed, true);
  assert.equal(edited.tags.due, unknown.tags.due);
   // HA projects native due last rather than persisting a byte-identical todo.txt line.
   composeEditedTask(edited, { description: "validate readback", list: "work", due: edited.tags.due }, "2026-11-15");
  assert.equal((await control()).items[0].description, "**HA description**\nretained");
  assert.equal((await request(`/api/tasks/${created.id}/uncomplete`, "POST")).creation_date, "2026-11-01");
  server.kill();
  await once(server, "exit");
  await start();
  state = await control(); state.items[0].status = "completed";
  await control({ items: state.items });
  const restarted = await request(`/api/tasks/${created.id}`);
  assert.equal(restarted.id, created.id);
  assert.equal(restarted.creation_date, null);
  assert.equal(restarted.completion_date, null);
   composeEditedTask(restarted, { description: "after restart", list: "work", due: restarted.tags.due }, "2026-11-15");
  const denied = await fetch(base + "/api/raw", { method: "PUT", body: "never upload" });
  assert.equal(denied.status, 400);
  assert.equal(await readFile(join(dir, "old-tasks.txt"), "utf8"), "do not migrate\n");
  await control({lists:{"todo.other":[]}, names:{"todo.other":"Shared tasks"}});
  const catalog = await request("/api/lists");
  assert.equal(catalog.lists.length, 2);
  const beforeMove = await request(`/api/tasks/${created.id}`);
   const movedText = composeEditedTask(beforeMove, {description:bareDescription(beforeMove.description, [], beforeMove.contexts, beforeMove.tags), list:"todo.other", due:beforeMove.tags.due}, "2026-11-16");
   assert.ok(movedText.includes("+work"), "summary list text remains lossless");
  assert.ok(!movedText.includes("+todo.other"), "routing must not be encoded as summary tokens");
  const moved = await request(`/api/tasks/${created.id}`, "PUT", movedText, {list_id:"todo.other", confirm_move:true, expected_source:"todo.fixture", expected_raw:beforeMove.raw});
  assert.equal(moved.id, created.id); assert.equal(moved.list_id, "todo.other");
  assert.equal((await control()).items.length, 0);
  assert.equal((await control()).lists["todo.other"][0].description, "**HA description**\nretained");
  const routed = await request("/api/tasks", "POST", "second list task", {list_id:"todo.other"});
  assert.equal(routed.list_id, "todo.other");
  const defaultTask = await request("/api/tasks", "POST", "default task", {list_id:""});
  assert.equal(defaultTask.list_id, "todo.fixture");
  server.kill(); await once(server, "exit"); await start();
  assert.equal((await request(`/api/tasks/${moved.id}`)).list_id, "todo.other");
  // Exercise public list mutation routes as well as their server-only WSS transport.
  server.kill(); await once(server, "exit"); env.HA_MANAGE_LISTS = "true"; await start();
  const addedCatalog = await request("/api/lists", "POST", undefined, {name:"Temporary list", confirmed:true});
  const temporary = addedCatalog.lists.find((list) => list.name === "Temporary list");
  assert.ok(temporary?.can_delete);
  await request(`/api/lists/${temporary.id}`, "PUT", undefined, {name:"Renamed temporary", expected_name:"Temporary list", confirmed:true});
  const deletedCatalog = await request(`/api/lists/${temporary.id}`, "DELETE", undefined, {expected_name:"Renamed temporary", confirmed:true});
  assert.ok(!deletedCatalog.lists.some((list) => list.id === temporary.id));
  await control({mode:"move_fail_delete"});
  const source = await request(`/api/tasks/${defaultTask.id}`);
  const failedMove = await fetch(base + `/api/tasks/${source.id}`, {method:"PUT", headers:{"content-type":"application/json"}, body:JSON.stringify({text:source.raw, list_id:"todo.other", confirm_move:true, expected_source:source.list_id, expected_raw:source.raw})});
  assert.equal(failedMove.status, 409);
  await control({mode:""});
  const pending = (await request("/api/lists")).pending_move;
  assert.ok(pending.operation_id > 1);
  const staleRecovery = await fetch(base + "/api/list-move/recovery", {method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({action:"abandon", confirmed:true, operation_id:pending.operation_id - 1})});
  assert.equal(staleRecovery.status, 409);
  assert.equal((await request("/api/lists")).pending_move.operation_id, pending.operation_id);
  const recovered = await request("/api/list-move/recovery", "POST", undefined, {action:"abandon", confirmed:true, operation_id:pending.operation_id});
  assert.equal(recovered.pending_move, null);
  assert.equal((await request(`/api/tasks/${source.id}`)).list_id, "todo.fixture");
  console.log("HA contract: real serializer, lifecycle/native fields, multiple lists, confirmed moves/recovery, admin list routes, default routing, restart IDs, and raw-write guard passed");
} finally {
  for (const child of [server, fake]) {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
  }
  await rm(dir, { recursive: true, force: true });
}
