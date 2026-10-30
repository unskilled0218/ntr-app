// The todo pane: add form, filter/sort row, task list. Owns the filter/sort state, the fetched
// tasks, and the server-derived label sets. Ported from the #todo-view section + the task/list/
// filter logic of app.js. Exposes onTasksChanged() so App can drive it from a live `change` event.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  completeTask,
  captureTransport,
  destination,
  isTransportCurrent,
  deleteTask as apiDeleteTask,
  errMsg,
  listTasks,
  createTask,
  getLabels,
  putLabels,
  uncompleteTask,
  updateTask,
  type Task,
  type Labels,
} from "../api";
import EditTaskModal from "./EditTaskModal";
import { sortTasks, type Direction } from "../config";
import {
  clearLegacyTodoPreferences,
  getSort,
  setSort as persistSort,
  getDirection,
  setDirection as persistDir,
} from "../settings";
import { parseLabelInput, removeProjectText, renameProjectText, unionLabels } from "../labels";
import AddForm from "./AddForm";
import FilterBar from "./FilterBar";
import RemoveLabelDialog from "./RemoveLabelDialog";
import TaskItem from "./TaskItem";
import { ResourceRefresh } from "../lib/resourceRefresh";
import type { ApplicationToken, RemoteUpdates } from "../lib/remoteUpdates";
import RenameProjectDialog from "./RenameProjectDialog";
import { ProjectRename, ProjectReviewRequired, projectRenameIO, type ProjectRenameEvent } from "../lib/projectRename";
import type { TransportContext } from "../api";
import { ProjectRemoval, type ProjectRemovalEvent } from "../lib/projectRemoval";
import type { ProjectActionRequest, ProjectManagement, ProjectOrigin, ProjectRecovery, ProjectSelectorSession } from "../lib/projectActions";

type ProjectRecord = { id: number; kind: "rename"; operation: ProjectRename } | { id: number; kind: "remove"; operation: ProjectRemoval };

export interface TodoPaneHandle {
  onTasksChanged: () => void;
  applyRemote: (token: ApplicationToken<"tasks">) => Promise<boolean>;
  reviewRemote: () => void;
}

interface Props {
  compact: boolean; // collapse the add fields and filter choosers into "Options" modals
  updates?: RemoteUpdates;
  onDialogChange?: (open: boolean) => void;
}

const TodoPane = forwardRef<TodoPaneHandle, Props>(({ compact, updates, onDialogChange }, ref) => {
  // Sort / direction are seeded from the local cache (lazy useState initializer runs once
  // on mount) and written back in their change handlers below, so the view options survive relaunch.
  const [project, setProject] = useState("");
  const [sort, setSort] = useState(getSort);
  const [dir, setDir] = useState<Direction>(getDirection);
  const [tasks, setTasks] = useState<Task[]>([]);
  const taskProjection = useRef(tasks);
  const projectTasks = (found: Task[]) => { taskProjection.current = found; setTasks(found); };
  const remote = () => captureTransport().url ? updates : undefined;
  const [serverLabels, setServerLabels] = useState<Labels>({ project: [], context: [] });
  const [error, setError] = useState("");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const editOwner = useRef(captureTransport());
  const editExpected = useRef<Task | null>(null);
  const [editSuspended, setEditSuspended] = useState(false);
  const [removing, setRemoving] = useState<{ kind: "project"; name: string } | null>(null);
  const [renameSource, setRenameSource] = useState<string | null>(null);
  const [renameOperation, setRenameOperation] = useState<ProjectRename | null>(null);
  const [removeOperation, setRemoveOperation] = useState<ProjectRemoval | null>(null);
  const records = useRef(new Map<string, ProjectRecord>());
  const displayedRecord = useRef<ProjectRecord | null>(null);
  const promptContext = useRef(captureTransport());
  const promptOrigin = useRef<ProjectOrigin>("filter");
  const promptSession = useRef<ProjectSelectorSession | undefined>(undefined);
  const [projectNotice, setProjectNotice] = useState("");
  const [renameEvent, setRenameEvent] = useState<ProjectRenameEvent>();
  const [removalEvent, setRemovalEvent] = useState<ProjectRemovalEvent>();
  const renameSequence = useRef(0);
  const [, redraw] = useState(0);
  const bulkOwner = useRef<TransportContext | null>(null);
  const queuedRefresh = useRef(false);
  const draftProjects = useRef({ add: [] as string[], edit: [] as string[] });
  const addProjects = useCallback((names: string[]) => { draftProjects.current.add = names; }, []);
  const editProjects = useCallback((names: string[]) => { draftProjects.current.edit = names; }, []);
  useEffect(() => { onDialogChange?.((!!editTask && !editSuspended) || !!removing || renameSource !== null); }, [editTask, editSuspended, removing, renameSource, onDialogChange]);
  const mounted = useRef(false);
  const tasksRequest = useRef(0);
  const labelsRequest = useRef(0);
  const readErrors = useRef({ tasks: "", labels: "" });
  const knownLabels = useRef(serverLabels);
  knownLabels.current = serverLabels;
  const recoveryContext = useRef(captureTransport());
  const recovery = useRef<ResourceRefresh | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      tasksRequest.current++;
      labelsRequest.current++;
      recovery.current?.cancel();
    };
  }, []);

  // Initial/local reads fetch all active and completed tasks. Project filtering and sorting
  // derive from this accepted projection at render; subsequent server reads only detect changes.
  const refresh = useCallback(async () => {
    const context = captureTransport();
    const request = ++tasksRequest.current;
    const current = () => mounted.current && request === tasksRequest.current && isTransportCurrent(context);
    if (context.url && updates?.accepted("tasks") !== undefined) {
      updates.request("tasks");
      return true;
    }
    try {
      const found = await listTasks({}, context);
      if (current()) {
        if (context.url && updates) updates.register("tasks", found);
        projectTasks(context.url && updates ? updates.accepted("tasks")! : found);
        readErrors.current.tasks = "";
        setError(readErrors.current.labels);
      }
      return true;
    } catch (err) {
      if (current()) {
        readErrors.current.tasks = `Could not load tasks: ${errMsg(err)}`;
        setError(readErrors.current.tasks);
      }
      return !current();
    }
  }, [updates]);

  // Merge task-derived labels into the remembered backend resource. A task mutation can grow this
  // set, but only explicit label removal shrinks it.
  // Stable (no project deps): a vanished filter is dropped via the functional setState
  // updater, which reads the latest value without closing over it — so this is created once and
  // is a correct dependency for the effect and the imperative handle below.
  const loadLabels = useCallback(async (persist = false) => {
    const context = captureTransport();
    const request = ++labelsRequest.current;
    const current = () => mounted.current && request === labelsRequest.current && isTransportCurrent(context);
    let all: Task[];
    let remembered: Labels;
    let labelsFailed = false;
    let labelError = "";
    try {
      remembered = await getLabels(context).catch((error) => {
        labelsFailed = true;
        labelError = `Could not load label suggestions: ${errMsg(error)}`;
        return knownLabels.current;
      });
      if (!current()) return true;
      all = taskProjection.current;
    } catch (err) {
      if (current()) {
        readErrors.current.labels = `Could not load label suggestions: ${errMsg(err)}`;
        setError(readErrors.current.tasks || readErrors.current.labels);
      }
      return !current();
    }
    if (!current()) return true;
    readErrors.current.labels = labelError;
    setError(readErrors.current.tasks || labelError);
    const projects = new Set<string>();
    const contexts = new Set<string>();
    for (const t of all) {
      for (const p of t.projects) projects.add(p);
      for (const c of t.contexts) contexts.add(c);
    }
    const merged: Labels = {
      project: unionLabels(remembered.project, [...projects]),
      context: unionLabels(remembered.context, [...contexts]),
    };
    setServerLabels(merged);
    setProject((p) => (p && !merged.project.includes(p) ? "" : p));
    if (
      (persist || !context.url) && !labelsFailed && (merged.project.length !== remembered.project.length ||
      merged.context.length !== remembered.context.length)
    ) {
      await putLabels(merged, context).catch(() => {});
    }
    return !labelsFailed;
  }, []);

  const readers = useRef({ refresh, loadLabels });
  readers.current = { refresh, loadLabels };
  if (!recovery.current) recovery.current = new ResourceRefresh(async () => {
    const results = [await readers.current.refresh(), await readers.current.loadLabels()];
    if (results.includes(false)) throw new Error("Task recovery pending");
  }, { canRun: () => mounted.current && isTransportCurrent(recoveryContext.current), onError: () => {} });

  function requestTasks() {
    if (bulkOwner.current && isTransportCurrent(bulkOwner.current)) { queuedRefresh.current = true; return; }
    if (!isTransportCurrent(recoveryContext.current)) {
      recovery.current!.cancel();
      recoveryContext.current = captureTransport();
      readErrors.current = { tasks: "", labels: "" };
      knownLabels.current = { project: [], context: [] };
    }
    recovery.current!.request();
  }

  // Initial/local reads and recovery share one resource runner. A newer request or transport
  // invalidates old responses without clearing visible data; filters never start a remote read.
  useEffect(() => {
    requestTasks();
  }, [refresh]);

  useEffect(() => {
    clearLegacyTodoPreferences();
  }, [loadLabels]);

  useImperativeHandle(
    ref,
    () => ({
      onTasksChanged: () => {
        requestTasks();
      },
      applyRemote: async (token) => {
        if (!updates || (editTask && !editSuspended) || removing || bulkOwner.current || renameSource !== null) {
          updates?.defer("tasks");
          setError("Close the task dialog, then review the update. Your draft is unchanged.");
          return false;
        }
        try {
          const owner = captureTransport();
          const labels = await getLabels(owner);
          return updates.commit(token, (snapshot) => {
            projectTasks(snapshot);
            setServerLabels({
              project: unionLabels(labels.project, snapshot.flatMap((task) => task.projects)),
              context: unionLabels(labels.context, snapshot.flatMap((task) => task.contexts)),
            });
            setError("");
          });
        } catch (error) {
          if (updates.valid(token)) updates.fail("tasks", `Could not load update: ${errMsg(error)}`);
          return false;
        }
      },
      reviewRemote: () => { if (bulkOwner.current) return; setEditSuspended(true); setRemoving(null); setRenameSource(null); },
    }),
    [refresh, loadLabels, updates, editTask, editSuspended, removing, renameSource],
  );

  function safeAction() {
    if (bulkOwner.current) { setError("Wait for the project operation to stop before changing tasks."); return false; }
    if (!remote() || (remote()!.accepted("tasks") !== undefined && !remote()!.blocked("tasks"))) return true;
    setEditSuspended(true);
    setRemoving(null);
    void remote()!.review("tasks");
    setError("Review the task update before using task IDs. Choose the action again after updating.");
    return false;
  }
  async function mutate(action: () => Promise<Task | void>, removeId?: number, owner = captureTransport(), persistLabels = true) {
    const settle = remote()?.begin("tasks");
    try {
      const task = await action();
      if (!isTransportCurrent(owner) || !mounted.current) { settle?.(); return task; }
      const known = remote()?.accepted("tasks") ?? taskProjection.current;
      const next = task ? (known.some((t) => t.id === task.id)
        ? known.map((t) => t.id === task.id ? task : t) : [...known, task]) : known.filter((t) => t.id !== removeId);
      settle?.(next);
      projectTasks(next);
      if (!persistLabels) setServerLabels((labels) => ({ project: unionLabels(labels.project, next.flatMap((found) => found.projects)), context: unionLabels(labels.context, next.flatMap((found) => found.contexts)) }));
      if (persistLabels) await loadLabels(true);
      return task;
    } catch (error) { settle?.(); throw error; }
  }

  async function onAdd(text: string): Promise<boolean> {
    try {
      if (bulkOwner.current) throw new Error("Wait for the project operation to stop before adding tasks.");
      guardDraft(text);
      await mutate(() => createTask(text));
      return true;
    } catch (err) {
      setError(errMsg(err));
      return false;
    }
  }

  async function onToggle(task: Task) {
    if (!safeAction()) return;
    try {
      await mutate(() => task.completed ? uncompleteTask(task.id) : completeTask(task.id));
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function onDelete(task: Task) {
    if (!safeAction()) return;
    try {
      await mutate(() => apiDeleteTask(task.id), task.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function onEdit(task: Task) {
    if (!safeAction()) return;
    setEditSuspended(false);
    editOwner.current = captureTransport();
    editExpected.current = task;
    setEditTask(task);
  }

  // Remove a project from the whole store: strip its token from every task that carries
  // it. Use the full accepted list (not the filtered view) so removal spans completed tasks too;
  // update each affected task sequentially (the file-backed, one-writer model), retaining each
  // successful response. loadLabels drops the unused name and clears a filter that selected it.
  async function confirmRemove() {
    if (!removing || bulkOwner.current) return;
    const owner = captureTransport();
    if (!isTransportCurrent(promptContext.current)) { setProjectNotice("The connection changed. Close and reopen the selector before confirming."); return; }
    let record = displayedRecord.current;
    if (!record) record = createRecord("remove", removing.name, "", owner);
    if (record.kind !== "remove" || record.operation.targetDestination !== destination(owner)) return;
    setProjectNotice("");
    setRemoveOperation(record.operation);
    startBulk(owner);
    try { await record.operation.run(owner); }
    finally { finishBulk(owner); }
  }

  function ensureProjectContext(owner: TransportContext) {
    if (!mounted.current || !isTransportCurrent(owner)) throw new Error("The connection changed. No further project writes were issued.");
  }
  function startBulk(owner: TransportContext) {
    bulkOwner.current = owner;
    tasksRequest.current++; labelsRequest.current++; recovery.current?.cancel();
  }
  function finishBulk(owner: TransportContext) {
    if (bulkOwner.current === owner) bulkOwner.current = null;
    if (mounted.current && queuedRefresh.current) { queuedRefresh.current = false; requestTasks(); }
  }
  async function validateProjectTasks(owner: TransportContext): Promise<Task[]> {
    ensureProjectContext(owner);
    if (owner.url && updates) {
      const checked = await updates.check("tasks");
      ensureProjectContext(owner);
      if (!checked) throw new ProjectReviewRequired();
      return updates.accepted("tasks")!;
    }
    const found = await listTasks({}, owner);
    ensureProjectContext(owner);
    const equal = found.length === taskProjection.current.length && found.every((task) => taskProjection.current.some((known) => known.id === task.id && known.raw === task.raw));
    if (!equal) {
      queuedRefresh.current = true;
      throw new Error("Local tasks changed. The task view will refresh after this attempt stops; explicitly retry against the current tasks.");
    }
    return found;
  }
  function guardDraft(text: string) {
    const operation = records.current.get(destination(captureTransport()))?.operation;
    if (operation?.started && operation.phase !== "completed" && operation.targetDestination === destination(captureTransport())
      && text.split(/\s+/).includes(`+${operation.from}`)) throw new Error("This draft refers to an unfinished project operation. Finish it or explicitly stop retry before saving it.");
  }
  function openRecord(record: ProjectRecord, origin: ProjectOrigin, session?: ProjectSelectorSession) {
    promptSession.current = record.kind === "rename" ? session : undefined;
    if (record.kind !== "rename") session?.close();
    displayedRecord.current = record;
    promptOrigin.current = origin; promptContext.current = captureTransport();
    if (record.kind === "rename") {
      setRemoving(null); setRemoveOperation(null); setRenameOperation(record.operation); setRenameSource(record.operation.from);
    } else {
      setRenameSource(null); setRenameOperation(null); setRemoveOperation(record.operation); setRemoving({ kind: "project", name: record.operation.from });
    }
  }
  function recoverProject(id: number, origin: ProjectOrigin, session?: ProjectSelectorSession) {
    if (bulkOwner.current) { session?.close(); setError("Wait for the current project attempt to settle."); return; }
    const record = [...records.current.values()].find((found) => found.id === id);
    if (record) { setProjectNotice(""); openRecord(record, origin, session); }
  }
  function projectAction(request: ProjectActionRequest): boolean {
    function reject(message: string) { request.session?.close(); setError(message); return true; }
    if (request.destination !== destination(captureTransport())) return reject("The destination changed. Reopen the selector.");
    if (bulkOwner.current) return reject("Wait for the current project attempt to settle.");
    const existing = records.current.get(request.destination);
    const pending = existing && existing.operation.started && existing.operation.phase !== "completed" ? existing : undefined;
    if (pending) {
      const related = pending.operation.from === request.name || (pending.kind === "rename" && pending.operation.to === request.name);
      if (related || request.scope === "known" || request.recoveryId !== undefined) {
        setProjectNotice(related && pending.kind === request.action ? "" : "Finish or explicitly stop this pending operation before starting another project action.");
        openRecord(pending, request.origin, request.session); return true;
      }
    }
    if (request.recoveryId !== undefined) return reject("That operation result changed. Reopen the selector.");
    if (request.scope === "staged") return false;
    if (!knownLabels.current.project.includes(request.name)) return reject("That project changed. Reopen the selector for a new confirmation.");
    displayedRecord.current = null;
    promptSession.current = request.action === "rename" ? request.session : undefined;
    if (request.action !== "rename") request.session?.close();
    promptContext.current = captureTransport(); promptOrigin.current = request.origin;
    setProjectNotice(""); setRenameOperation(null); setRemoveOperation(null);
    if (request.action === "rename") { setRemoving(null); setRenameSource(request.name); }
    else { setRenameSource(null); setRemoving({ kind: "project", name: request.name }); }
    return true;
  }
  function createRecord(kind: "rename" | "remove", from: string, to: string, owner: TransportContext): ProjectRecord {
    let record: ProjectRecord;
    const ports = {
      ...projectRenameIO, validate: validateProjectTasks,
      write: async (id: number, text: string, context: TransportContext) => {
        const task = await mutate(() => updateTask(id, text, context), undefined, context, false);
        if (!task) throw new Error("The task write returned no task. Revalidate before retrying.");
        return task;
      },
      staged: () => [...draftProjects.current.add, ...draftProjects.current.edit],
      current: () => mounted.current && records.current.get(record.operation.targetDestination) === record,
      changed: () => { if (mounted.current) redraw((n) => n + 1); },
      completed: (labels: Labels) => completeProject(record, labels),
    };
    record = kind === "rename" ? { id: ++renameSequence.current, kind, operation: new ProjectRename(from, to, owner, ports) }
      : { id: ++renameSequence.current, kind, operation: new ProjectRemoval(from, owner, ports) };
    records.current.set(destination(owner), record); displayedRecord.current = record;
    return record;
  }
  function completeProject(record: ProjectRecord, labels: Labels) {
    ensureProjectContext(captureTransport());
    const operation = record.operation;
    if (destination(captureTransport()) !== operation.targetDestination) return;
    const known = remote()?.accepted("tasks") ?? taskProjection.current;
    setServerLabels({ project: unionLabels(labels.project, known.flatMap((task) => task.projects)), context: unionLabels(labels.context, known.flatMap((task) => task.contexts)) });
    const transform = (text: string) => record.kind === "rename" ? renameProjectText(text, operation.from, record.operation.to) : removeProjectText(text, operation.from);
    const updated = operation.done.get(editExpected.current?.id ?? -1);
    if (updated && editExpected.current && destination(editOwner.current) === operation.targetDestination && transform(editExpected.current.raw) === updated.raw) editExpected.current = updated;
    const event = { id: ++renameSequence.current, destination: operation.targetDestination, from: operation.from, tasks: [...operation.done.values()] };
    if (record.kind === "rename") {
      setProject((selected) => selected === operation.from ? record.operation.to : selected);
      setRenameEvent({ ...event, to: record.operation.to });
    } else {
      setProject((selected) => selected === operation.from ? "" : selected);
      setRemovalEvent(event);
    }
    setProjectNotice(""); setError("");
  }
  async function confirmRename(name: string) {
    if (renameSource === null || bulkOwner.current) return;
    const parsed = parseLabelInput(name);
    if ("error" in parsed) return;
    const owner = captureTransport();
    if (!isTransportCurrent(promptContext.current)) { setProjectNotice("The connection changed. Close and reopen the selector before confirming."); return; }
    let record = displayedRecord.current;
    if (!record || !record.operation.started) record = createRecord("rename", renameSource, parsed.name, owner);
    if (record.kind !== "rename" || record.operation.targetDestination !== destination(owner)) return;
    setProjectNotice("");
    setRenameOperation(record.operation);
    startBulk(owner);
    try { await record.operation.run(owner); }
    finally { finishBulk(owner); }
    if (mounted.current && isTransportCurrent(owner) && displayedRecord.current === record && record.operation.phase === "completed") {
      closeRename(record.operation.to, record.operation.from === record.operation.to ? undefined : renameSequence.current);
    }
  }
  function closeRename(focusName?: string, revision?: number) {
    if (displayedRecord.current?.operation.busy) return;
    setRenameSource(null); setRemoving(null);
    const record = displayedRecord.current;
    if (record && (!record.operation.started || record.operation.phase === "completed")) records.current.delete(record.operation.targetDestination);
    if (promptSession.current) {
      promptSession.current.restore(focusName ?? record?.operation.from ?? renameSource ?? "", revision);
      promptSession.current = undefined;
      return;
    }
    const selector = promptOrigin.current === "add" ? (compact ? '#add-form button[aria-label="Task options"]' : '#add-form button[aria-label="Project"]')
      : (compact ? 'button[aria-label="Filter options"]' : 'button[aria-label="Project filter"]');
    document.querySelector<HTMLButtonElement>(selector)?.focus();
  }
  function reviewRename() {
    if (bulkOwner.current) return;
    promptSession.current?.close(); promptSession.current = undefined;
    setRenameSource(null); setEditSuspended(true); setRemoving(null);
    void remote()?.review("tasks");
  }
  function abandonRename() {
    if (bulkOwner.current) return;
    const record = displayedRecord.current;
    if (record) records.current.delete(record.operation.targetDestination);
    closeRename(); displayedRecord.current = null; setRenameOperation(null); setRemoveOperation(null);
    setError("Project retry stopped. Partial task and label changes remain; no changes were rolled back.");
  }

  async function onEditSave(id: number, text: string) {
    if (destination(editOwner.current) !== destination(captureTransport())) {
      throw new Error("The destination changed. Copy your draft and choose Edit on the current destination.");
    }
    if (!safeAction()) throw new Error("Review the task update first. Your draft is unchanged.");
    guardDraft(text);
    if (!(remote()?.accepted("tasks") ?? taskProjection.current).some((task) => task.id === id && task.raw === editExpected.current?.raw)) {
      throw new Error("This task changed. Copy your draft and choose Edit on the updated task; the old action cannot be replayed.");
    }
    await mutate(() => updateTask(id, text)); // throws on error → caught by EditTaskModal
    setEditTask(null);
  }

  const sorted = sortTasks(tasks.filter((task) => !project || task.projects.includes(project)), sort, dir);
  const pending: ProjectRecovery[] = [...records.current.values()].filter((record) => record.operation.started && record.operation.phase !== "completed").map((record) => ({
    id: record.id, kind: record.kind, from: record.operation.from, to: record.kind === "rename" ? record.operation.to : undefined,
    destination: record.operation.targetDestination, summary: `Unfinished ${record.kind === "rename" ? "rename" : "removal"}: ${record.operation.done.size} tasks updated. Open its action to finish or stop retry.`,
  }));
  const management: ProjectManagement = { destination: destination(captureTransport()), pending, onAction: projectAction, onRecover: recoverProject };

  return (
    <section className="pane todo-pane" id="todo-view">
      <div className={compact ? "todo-header todo-header--compact" : "todo-header"}>
        <h1>todo</h1>

        <FilterBar
          project={project}
          sort={sort}
          dir={dir}
          compact={compact}
          serverLabels={serverLabels}
          onProject={setProject}
          onSort={(s) => { setSort(s); persistSort(s); }}
          onDir={(d) => { const next = d as Direction; setDir(next); persistDir(next); }}
          onRemove={(kind, name) => setRemoving({ kind, name })}
          management={management}
        />
      </div>
      
      <div className="task-list">
        <ul id="tasks">
          {sorted.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
        <p id="empty" hidden={sorted.length !== 0}>
          No tasks.
        </p>
        <p id="error" role="alert" hidden={!error}>
          {error}
        </p>
      </div>

      <AddForm serverLabels={serverLabels} onAdd={onAdd} compact={compact} rename={renameEvent} removal={removalEvent} onProjectsChange={addProjects} management={management} />
      {editTask && editSuspended && <button type="button" onClick={() => setEditSuspended(false)}>Resume task draft</button>}

      <EditTaskModal
        task={editTask}
        suspended={editSuspended}
        serverLabels={serverLabels}
        onSave={onEditSave}
        onClose={() => setEditTask(null)}
        rename={renameEvent}
        removal={removalEvent}
        onProjectsChange={editProjects}
      />

      <RemoveLabelDialog target={removing} operation={removeOperation} error={projectNotice} onConfirm={() => { void confirmRemove(); }} onCancel={closeRename}
        onReview={reviewRename} onAbandon={abandonRename} readOnly={!!removeOperation && removeOperation.targetDestination !== management.destination} />
      <RenameProjectDialog source={renameSource} operation={renameOperation}
        onConfirm={(name) => { void confirmRename(name); }} onClose={closeRename} onReview={reviewRename} onAbandon={abandonRename} error={projectNotice}
        readOnly={!!renameOperation && renameOperation.targetDestination !== management.destination} />
    </section>
  );
});

TodoPane.displayName = "TodoPane";
export default TodoPane;
