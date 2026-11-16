// Exercise the actual client serializer against disk-backed local, new HTTP, and optional old HTTP backends.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const root = resolve(import.meta.dirname, "..");
const dir = await mkdtemp(join(process.env.TMPDIR ?? tmpdir(), "ntr-task-contract-"));
const cargo = (cwd, args) => execFileSync("cargo", args, { cwd, stdio: "inherit" });
try {
  await build({ configFile: false, root, logLevel: "error", build: {
    outDir: join(dir, "client"), emptyOutDir: false,
    lib: { entry: { labels: join(root, "src/labels.ts"), listWire: join(root, "src/lib/listWire.ts") }, formats: ["es"], fileName: (_format, name) => `${name}.mjs` },
  } });
  const { composeText, composeEditedTask, bareDescription } = await import(pathToFileURL(join(dir, "client/labels.mjs")));
  const { taskFromWire } = await import(pathToFileURL(join(dir, "client/listWire.mjs")));
  cargo(join(root, "src-tauri"), ["build", "--locked", "--example", "task_contract"]);
  const binary = resolve(process.env.CARGO_TARGET_DIR ?? join(root, "src-tauri/target"), "debug/examples/task_contract");
  const localDir = join(dir, "local");
  const local = async (op, text = "") => JSON.parse(execFileSync(binary, [localDir, op, text], { encoding: "utf8" }));
  await exercise("local", local, async () => readFile(join(localDir, "todo.txt"), "utf8"), false);

  const serverRoot = resolve(process.env.NTR_SERVER_SOURCE ?? join(root, "../server"));
  cargo(serverRoot, ["build", "--locked"]);
  const newBinary = resolve(process.env.CARGO_TARGET_DIR ?? join(serverRoot, "target"), "debug/my-ntr-server");
  await httpBackend("new-server", newBinary, false);
  if (process.env.OLD_NTR_SERVER_BIN) {
    await httpBackend("old-server", resolve(process.env.OLD_NTR_SERVER_BIN), true);
  } else {
    console.log("Old-server checks not run: set OLD_NTR_SERVER_BIN to a pre-removal server binary.");
  }

  async function exercise(name, run, raw, old) {
    const transport = run;
    run = async (...args) => taskFromWire(await transport(...args));
    const fields = { list: "work", due: "2026-11-01" };
    for (const completed of [false, true]) {
      for (const shape of ["new", "old"]) {
        for (const tokens of ["pri:A pri:B pri:A", "pri:A pri:A", "pri:A pri:B", "pri:B pri:A", "pri:C", ""]) {
          const body = "call pri:A pri:B pri:A +work @phone custom:yes";
          const initial = `${completed ? "x " : ""}(Z) ${completed ? "2026-10-20 " : ""}2026-10-01 ${body}`;
          let dto = await run("raw", initial);
          // Extra old response fields must not influence the authoritative raw prefix.
          if (shape === "old") dto = { ...dto, priority: "A" };
          assert.equal(bareDescription(dto.description, dto.lists, dto.contexts, dto.tags), "call pri:A pri:B pri:A");
          const description = `call${tokens ? ` ${tokens}` : ""}`;
          const text = composeEditedTask(dto, { ...fields, description }, "2026-10-30");
          const saved = await run("edit", text);
          assert.equal(saved.raw, text, name);
          assert.equal((await run("get")).raw, text);
          assert.equal((await raw()).trim(), text);
          assert.equal(saved.creation_date, "2026-10-01");
          assert.equal(saved.completion_date, completed ? "2026-10-20" : null);
          assert.deepEqual(saved.description.match(/\bpri:[A-Z]\b/g) ?? [], tokens ? tokens.split(" ") : []);
          await run("add", "different task");
          assert.equal((await run("get")).raw, text, "unrelated write preserves the edited line");
          for (const badRaw of [undefined, "", "x wrong", "(Z) 2026-10-02 wrong", "(Z)broken"]) {
            assert.throws(() => composeEditedTask({ ...dto, raw: badRaw }, { ...fields, description }, "2026-10-30"), /Cannot safely edit/);
            assert.equal((await run("get")).raw, text);
          }
        }
      }
    }
    for (const description of ["(A)call", "(a) call", "(AA) call", "(A)) call", "call (A)", "call pri:A pri:B pri:A"]) {
      const text = composeText({ description, list: "", contexts: [], due: "" });
      const dto = await run("raw", text);
      assert.equal(dto.description, description);
      const edited = composeEditedTask(dto, { description, list: "", due: "" }, "2026-10-30");
      await run("edit", edited);
      await run("complete");
      const reopened = await run("reopen");
      // Old servers consume pri:A when reopening; this is an explicit compatibility limit.
      if (old && description.includes("pri:A")) {
        assert.ok(reopened.raw.startsWith("(A) "));
        assert.equal(reopened.description, "call pri:B pri:A updated:2026-10-30");
      } else {
        assert.equal(reopened.raw, edited);
        assert.equal((await run("get")).description, `${description} updated:2026-10-30`);
      }
    }
    for (const description of ["(A)", "(A) call"]) {
      assert.throws(() => composeText({ description, list: "", contexts: [], due: "" }), /reserved for legacy data/);
    }
    // The plan's unconditional submitted-description guard also blocks existing visible leading tokens after dates.
    for (const initial of ["2026-06-01 (A) call", "x 2026-06-02 2026-06-01 (A) call"]) {
      const dto = await run("raw", initial);
      assert.equal(dto.description, "(A) call");
      assert.throws(() => composeEditedTask(dto, { ...fields, description: dto.description }, "2026-10-30"), /reserved for legacy data/);
      assert.equal((await run("get")).raw, initial);
      assert.equal((await raw()).trim(), initial);
    }
    const initial = "(Z) 2026-10-01 call pri:A";
    await run("raw", initial);
    const done = await run("complete");
    if (old) {
      assert.ok(!done.raw.startsWith("x (Z)"));
      assert.ok(done.description.endsWith("pri:A pri:Z"));
      const reopened = await run("reopen");
      assert.equal(reopened.raw, "(A) 2026-10-01 call pri:Z");
    } else {
      assert.ok(done.raw.startsWith("x (Z) "));
      assert.equal(done.description, "call pri:A");
      assert.equal((await run("reopen")).raw, initial);
    }
    console.log(`${name}: serializer, save/reload, ordinary text, legacy prefix, dates, and lifecycle checks passed`);
  }

  async function httpBackend(name, executable, old) {
    const socket = createServer();
    await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
    const port = socket.address().port;
    await new Promise((resolve) => socket.close(resolve));
    const file = join(dir, `${name}.txt`);
    const child = spawn(executable, [], { env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), TODO_FILE: file, NOTE_FILE: join(dir, `${name}.md`), LABELS_FILE: join(dir, `${name}.json`), TODO_ADD_CREATION_DATE: "false" }, stdio: ["ignore", "ignore", "inherit"] });
    const base = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        try { ready = (await fetch(`${base}/api/health`)).ok; } catch {}
        if (ready) break;
        if (child.exitCode !== null) throw new Error(`${name} exited before startup`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(ready, `${name} startup timed out`);
      const request = async (path, method = "GET", text, raw = false) => {
        const response = await fetch(`${base}${path}`, { method, headers: { "content-type": raw ? "text/plain" : "application/json" }, body: text === undefined ? undefined : raw ? text : JSON.stringify({ text }) });
        assert.ok(response.ok, `${name} ${method} ${path}: ${await response.clone().text()}`);
        return response.status === 204 ? null : raw ? response.text() : response.json();
      };
      // Raw replacement reassigns IDs. Read the first task's actual ID on each operation.
      const run = async (op, text) => {
        if (op === "raw") await request("/api/raw", "PUT", text, true);
        if (op === "add") await request("/api/tasks", "POST", text);
        const tasks = await request("/api/tasks");
        const path = `/api/tasks/${tasks[0].id}`;
        if (op === "edit") return request(path, "PUT", text);
        if (op === "complete" || op === "reopen") return request(`${path}/${op === "reopen" ? "uncomplete" : "complete"}`, "POST", "");
        return request(path);
      };
      await exercise(name, run, () => readFile(file, "utf8"), old);
    } finally {
      child.kill();
      await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
    }
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
