import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { captureTransport, createTask, endTransportSession, finishInitialization, getHaCatalog, manageHaList, markResourceReady, recoverHaMove, startTransportSession, updateTask } from "./api";

vi.mock("@tauri-apps/api/core", () => ({invoke:vi.fn()}));
vi.mock("@tauri-apps/api/event", () => ({listen:vi.fn()}));
let calls:{path:string; method:string; body:unknown}[];
let status = 200;
beforeEach(() => {
  localStorage.clear(); localStorage.setItem("ntr.serverUrl", "https://ntr.test"); calls = []; status = 200;
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command !== "server_fetch") return;
    const req = (args as {req:{url:string; method:string; body?:string}}).req;
    const path = new URL(req.url).pathname;
    calls.push({path, method:req.method, body:req.body ? JSON.parse(req.body) : undefined});
    const body = path === "/api/capabilities" ? {task_backend:"homeassistant", raw_task_replace:false} : path === "/api/lists" ? {lists:[{id:"todo.default",name:"Default",is_default:true}],can_create:false,pending_move:null} : path === "/api/raw" ? "task\n" : {id:1,list_id:"todo.target",raw:"task",description:"task",lists:["todo.target"]};
    return {ok:status === 200, status, status_text:"Response", body:typeof body === "string" ? body : JSON.stringify(body)};
  });
  startTransportSession(); markResourceReady("tasks", captureTransport()); finishInitialization(captureTransport());
});
afterEach(() => {endTransportSession(); localStorage.clear();});

it("uses the catalog endpoint rather than remembered labels", async () => {
  expect((await getHaCatalog())?.lists[0].id).toBe("todo.default");
  expect(calls.map((c) => c.path)).toEqual(["/api/capabilities", "/api/lists"]);
});
it("sends routing and fresh explicit move confirmation only in task JSON", async () => {
  await createTask("task +literal", {list_id:"todo.target"});
  expect(calls[0]).toMatchObject({path:"/api/tasks",method:"POST",body:{text:"task +literal",list_id:"todo.target"}});
  calls = [];
  const routing = {list_id:"todo.target",confirm_move:true,expected_source:"todo.source",expected_raw:"old task"};
  await updateTask(1, "new task", captureTransport(), routing);
  expect(calls[0]).toMatchObject({path:"/api/tasks/1",method:"PUT",body:{text:"new task",...routing}});
});
it("administrative and recovery requests are separate from task and label writes", async () => {
  await manageHaList("delete", "todo.empty", "", "Empty");
  await recoverHaMove("abandon", 1);
  expect(calls).toEqual([
    {path:"/api/lists/todo.empty",method:"DELETE",body:{name:"",confirmed:true,expected_name:"Empty"}},
    {path:"/api/list-move/recovery",method:"POST",body:{action:"abandon",operation_id:1,confirmed:true}},
  ]);
});
it("an uncertain administrative response is not replayed", async () => {
  status = 504;
  await expect(manageHaList("create", "", "New", "")).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
it("shows sanitized server list-management errors instead of hiding empty-list safety failures", async () => {
  vi.mocked(invoke).mockResolvedValue({ok:false, status:400, status_text:"Bad Request", body:JSON.stringify({error:"Only empty lists can be deleted, including completed tasks"})});
  await expect(manageHaList("delete", "todo.shared", "", "Shared")).rejects.toThrow("Only empty lists can be deleted");
  expect(invoke).toHaveBeenCalled();
});
it("rejects stale captured destinations before administrative or recovery writes", async () => {
  const owner = captureTransport(); localStorage.setItem("ntr.serverUrl", "https://other.test");
  await expect(manageHaList("rename", "todo.old", "New", "Old", owner)).rejects.toThrow();
  await expect(recoverHaMove("abandon", 1, owner)).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
