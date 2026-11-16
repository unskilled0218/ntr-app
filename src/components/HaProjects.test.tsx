import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import HaProjects, { HaListPicker } from "./HaProjects";
import AddForm from "./AddForm";
import EditTaskModal from "./EditTaskModal";
import { manageHaList, recoverHaMove, type HaCatalog, type Task } from "../api";

vi.mock("../api", async (original) => ({...await original<typeof import("../api")>(), manageHaList:vi.fn(), recoverHaMove:vi.fn()}));
const CATALOG:HaCatalog = {can_create:true, pending_move:null, lists:[
  {id:"todo.personal", name:"Personal tasks", is_default:true, can_rename:true, can_delete:false},
  {id:"todo.shared", name:"Shared tasks", is_default:false, can_rename:true, can_delete:true},
]};
const TASK:Task = {id:7, list_id:"todo.personal", completed:false, creation_date:"2026-01-01", completion_date:null, description:"keep +legacy +todo.personal due:2026-11-16T23:00:00-05:00", raw:"2026-01-01 keep +legacy +todo.personal due:2026-11-16T23:00:00-05:00", projects:["todo.personal"], contexts:[], tags:{due:"2026-11-16T23:00:00-05:00"}};
function Wrapper({children, catalog = CATALOG}: {children:ReactNode; catalog?:HaCatalog}) {
  const [current, setCurrent] = useState(catalog);
  return <HaProjects catalog={current} disabled={false} setCatalog={setCurrent} beforeMutation={() => true} onChanged={() => {}}>{children}</HaProjects>;
}
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); vi.mocked(manageHaList).mockResolvedValue(CATALOG); vi.mocked(recoverHaMove).mockResolvedValue(CATALOG); });
afterEach(cleanup);
function picker() { return within(document.querySelector("dialog.select-modal[open]") as HTMLElement); }

it("HA add sends explicit list IDs without inserting list names or removing legacy tokens", async () => {
  const add = vi.fn().mockResolvedValue(true);
  render(<Wrapper><AddForm compact={false} serverLabels={{project:[],context:[]}} onAdd={add} /></Wrapper>);
  fireEvent.change(screen.getByLabelText("New task"), {target:{value:"call +legacy"}});
  fireEvent.click(screen.getByRole("button", {name:"Project"}));
  fireEvent.click(picker().getByRole("button", {name:"Shared tasks"}));
  fireEvent.submit(document.getElementById("add-form")!);
  await waitFor(() => expect(add).toHaveBeenCalledWith("call +legacy", "todo.shared"));
  fireEvent.change(screen.getByLabelText("New task"), {target:{value:"default task"}});
  fireEvent.submit(document.getElementById("add-form")!);
  await waitFor(() => expect(add).toHaveBeenLastCalledWith("default task", ""));
});

it("same-list edits preserve literal project tokens and native datetime without move confirmation", async () => {
  const save = vi.fn().mockResolvedValue(undefined);
  render(<Wrapper><EditTaskModal task={TASK} serverLabels={{project:[],context:[]}} onSave={save} onClose={() => {}} /></Wrapper>);
  expect((screen.getByLabelText("Task description") as HTMLInputElement).value).toBe("keep +legacy +todo.personal");
  fireEvent.click(screen.getByRole("button", {name:"Save"}));
  await waitFor(() => expect(save).toHaveBeenCalledWith(7, expect.stringContaining("keep +legacy +todo.personal"), {list_id:"todo.personal", expected_source:"todo.personal", expected_raw:TASK.raw}));
  expect(save.mock.calls[0][1]).toContain("due:2026-11-16T23:00:00-05:00");
  expect(save.mock.calls[0][1]).not.toContain("+Personal tasks");
});

it("moving requires confirmation; cancel makes no write and failure preserves the draft", async () => {
  const save = vi.fn().mockRejectedValue(new Error("uncertain move"));
  render(<Wrapper><EditTaskModal task={TASK} serverLabels={{project:[],context:[]}} onSave={save} onClose={() => {}} /></Wrapper>);
  fireEvent.click(screen.getByRole("button", {name:"Project"})); fireEvent.click(picker().getByRole("button", {name:"Shared tasks"}));
  fireEvent.click(screen.getByRole("button", {name:"Save"}));
  let dialog = within(screen.getByRole("dialog", {name:"Move task to another HA list"}));
  expect(save).not.toHaveBeenCalled(); fireEvent.click(dialog.getByRole("button", {name:"Cancel"}));
  expect(save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", {name:"Save"}));
  dialog = within(screen.getByRole("dialog", {name:"Move task to another HA list"}));
  fireEvent.click(dialog.getByRole("button", {name:"Move task"}));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][2]).toMatchObject({list_id:"todo.shared", confirm_move:true, expected_source:"todo.personal", expected_raw:TASK.raw});
  expect(await dialog.findByText(/uncertain move/)).toBeTruthy();
  expect((screen.getByLabelText("Task description") as HTMLInputElement).value).toContain("+legacy");
});

it("list creation is asynchronous and does not stage a fake project or submit a task", async () => {
  const add = vi.fn();
  render(<Wrapper><AddForm compact={false} serverLabels={{project:[],context:[]}} onAdd={add} /></Wrapper>);
  fireEvent.click(screen.getByRole("button", {name:"Project"})); fireEvent.click(picker().getByRole("button", {name:"+ Add project..."}));
  const dialog = within(screen.getByRole("dialog", {name:"Create HA list"}));
  fireEvent.change(dialog.getByLabelText("HA list name"), {target:{value:"New shared list"}});
  fireEvent.click(dialog.getByRole("button", {name:"Confirm"}));
  await waitFor(() => expect(manageHaList).toHaveBeenCalledWith("create", "", "New shared list", "", expect.any(Object)));
  expect(add).not.toHaveBeenCalled();
});

it("catalog-only updates invalidate open list deletion confirmations", async () => {
  const props = {disabled:false, setCatalog:vi.fn(), beforeMutation:() => true, onChanged:vi.fn()};
  const renderCatalog = (catalog:HaCatalog) => <HaProjects {...props} catalog={catalog}><HaListPicker filter value="" onChange={() => {}} /></HaProjects>;
  const view = render(renderCatalog(CATALOG));
  fireEvent.click(screen.getByRole("button", {name:"Project filter"})); fireEvent.click(picker().getByRole("button", {name:"Remove Shared tasks"}));
  view.rerender(renderCatalog({...CATALOG, lists:CATALOG.lists.map((list) => list.id === "todo.shared" ? {...list, name:"Renamed externally"} : list)}));
  const dialog = within(screen.getByRole("dialog", {name:"Delete HA list"}));
  fireEvent.click(dialog.getByRole("button", {name:"Confirm"}));
  expect(await dialog.findByText(/catalog or connection changed/)).toBeTruthy(); expect(manageHaList).not.toHaveBeenCalled();
});

it("duplicate display names retain distinct IDs and default/unsupported actions remain unavailable", () => {
  const catalog = {...CATALOG, can_create:false, lists:CATALOG.lists.map((list) => ({...list, name:"Same", can_rename:false, can_delete:false}))};
  render(<Wrapper catalog={catalog}><HaListPicker value="" onChange={() => {}} /></Wrapper>);
  fireEvent.click(screen.getByRole("button", {name:"Project"}));
  expect(picker().getByRole("button", {name:"Same (todo.personal)"})).toBeTruthy();
  expect(picker().getByRole("button", {name:"Same (todo.shared)"})).toBeTruthy();
  expect(picker().queryByRole("button", {name:/Add project|Remove |Rename /})).toBeNull();
});

it("abandoning a pending move is explicitly confirmed and never requests list deletion", async () => {
  const catalog = {...CATALOG, pending_move:{operation_id:1, task_id:7, source_list:"todo.personal", target_list:"todo.shared", copy_identified:false}};
  render(<Wrapper catalog={catalog}><span>Tasks</span></Wrapper>);
  fireEvent.click(screen.getByRole("button", {name:"Abandon move"}));
  expect(recoverHaMove).not.toHaveBeenCalled();
  const dialog = within(screen.getByRole("dialog", {name:"Abandon HA move"}));
  fireEvent.click(dialog.getByRole("button", {name:"Confirm"}));
  await waitFor(() => expect(recoverHaMove).toHaveBeenCalledWith("abandon", 1, expect.any(Object)));
  expect(manageHaList).not.toHaveBeenCalled();
});
