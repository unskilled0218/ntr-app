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
    lib: { entry: join(root, "src/labels.ts"), formats: ["es"], fileName: () => "labels.mjs" },
  } });
  const { composeEditedTask, bareDescription } = await import(pathToFileURL(join(dir, "client/labels.mjs")));
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
  const request = async (path, method = "GET", text) => {
    const response = await fetch(base + path, { method, headers: { "content-type": "application/json" }, body: text === undefined ? undefined : JSON.stringify({ text }) });
    assert.ok(response.ok, `${method} ${path}: ${await response.clone().text()}`);
    return response.status === 204 ? null : response.json();
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
  const description = bareDescription(unknown.description, unknown.projects, unknown.contexts, unknown.tags);
  const text = composeEditedTask(unknown, { description: description + " edited", project: "work", due: unknown.tags.due }, "2026-11-15");
  const edited = await request(`/api/tasks/${created.id}`, "PUT", text);
  assert.equal(edited.completed, true);
  assert.equal(edited.tags.due, unknown.tags.due);
  // HA projects native due last rather than persisting a byte-identical todo.txt line.
  composeEditedTask(edited, { description: "validate readback", project: "work", due: edited.tags.due }, "2026-11-15");
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
  composeEditedTask(restarted, { description: "after restart", project: "work", due: restarted.tags.due }, "2026-11-15");
  const denied = await fetch(base + "/api/raw", { method: "PUT", body: "never upload" });
  assert.equal(denied.status, 400);
  assert.equal(await readFile(join(dir, "old-tasks.txt"), "utf8"), "do not migrate\n");
  console.log("HA contract: actual client edit serializer, external completion, creation restoration, datetime, description, restart IDs, and raw-write guard passed");
} finally {
  for (const child of [server, fake]) {
    if (child && child.exitCode === null && child.signalCode === null) { child.kill(); await once(child, "exit"); }
  }
  await rm(dir, { recursive: true, force: true });
}
