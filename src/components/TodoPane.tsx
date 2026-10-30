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
import { parseLabelInput, planLabelRemoval, renameProjectText, unionLabels } from "../labels";
import AddForm from "./AddForm";
import FilterBar from "./FilterBar";
import RemoveLabelDialog from "./RemoveLabelDialog";
import TaskItem from "./TaskItem";
import { ResourceRefresh } from "../lib/resourceRefresh";
import type { ApplicationToken, RemoteUpdates } from "../lib/remoteUpdates";
import RenameProjectDialog from "./RenameProjectDialog";
import { ProjectRename, ProjectReviewRequired, projectRenameIO, type ProjectRenameEvent } from "../lib/projectRename";
import type { TransportContext } from "../api";

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
  const renameRef = useRef<ProjectRename | null>(null);
  const [renameEvent, setRenameEvent] = useState<ProjectRenameEvent>();
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
    if (!removing) return;
    if (!safeAction()) return;
    const { kind, name } = removing;
    setRemoving(null);
    const owner = captureTransport();
    startBulk(owner);
    try {
      const all = await validateProjectTasks(owner);
      for (const u of planLabelRemoval(all, kind, name)) {
        const current = await validateProjectTasks(owner);
        if (current.find((task) => task.id === u.id)?.raw !== all.find((task) => task.id === u.id)?.raw) throw new ProjectReviewRequired();
        await mutate(() => updateTask(u.id, u.text, owner), undefined, owner, false);
        await validateProjectTasks(owner);
      }
      const remembered = await getLabels(owner);
      ensureProjectContext(owner);
      await putLabels({ ...remembered, project: remembered.project.filter((n) => n !== name) }, owner);
      ensureProjectContext(owner);
      await loadLabels();
    } catch (err) {
      // Successful responses already projected their own changes; never import an unrelated
      // remote list or erase labels to recover a partial failure.
      if (mounted.current && isTransportCurrent(owner)) {
        setError(`Project removal stopped; completed changes remain. ${errMsg(err)}`);
        if (err instanceof ProjectReviewRequired) void remote()?.review("tasks");
      }
    } finally { finishBulk(owner); }
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
    const operation = renameRef.current;
    if (operation?.started && operation.phase !== "completed" && operation.targetDestination === destination(captureTransport())
      && text.split(/\s+/).includes(`+${operation.from}`)) throw new Error("This draft refers to a partially renamed project. Finish or resolve the rename before saving it.");
  }
  function openRename(name: string) {
    if (bulkOwner.current) return;
    const existing = renameRef.current;
    if (existing?.started && existing.phase !== "completed") {
      setRenameSource(existing.from);
      return;
    }
    renameRef.current = null; setRenameOperation(null); setRenameSource(name);
  }
  async function confirmRename(name: string) {
    if (renameSource === null || bulkOwner.current) return;
    const parsed = parseLabelInput(name);
    if ("error" in parsed) return;
    const owner = captureTransport();
    let operation = renameRef.current;
    if (!operation || !operation.started) {
      operation = new ProjectRename(renameSource, parsed.name, owner, {
        ...projectRenameIO,
        validate: validateProjectTasks,
        write: async (id, text, context) => (await mutate(() => updateTask(id, text, context), undefined, context, false))!,
        staged: () => [...draftProjects.current.add, ...draftProjects.current.edit],
        current: () => mounted.current && renameRef.current === operation,
        changed: () => { if (mounted.current) redraw((n) => n + 1); },
        completed: (labels) => {
          ensureProjectContext(captureTransport());
          const completed = operation!;
          const known = remote()?.accepted("tasks") ?? taskProjection.current;
          setServerLabels({
            project: unionLabels(labels.project, known.flatMap((task) => task.projects)),
            context: unionLabels(labels.context, known.flatMap((task) => task.contexts)),
          });
          setProject((selected) => selected === completed.from ? completed.to : selected);
          const updated = completed.done.get(editExpected.current?.id ?? -1);
          if (updated && editExpected.current && renameProjectText(editExpected.current.raw, completed.from, completed.to) === updated.raw) editExpected.current = updated;
          setRenameEvent({ id: ++renameSequence.current, destination: completed.targetDestination, from: completed.from, to: completed.to, tasks: [...completed.done.values()] });
          setError("");
        },
      });
      renameRef.current = operation; setRenameOperation(operation);
    }
    startBulk(owner);
    try { await operation.run(owner); }
    finally { finishBulk(owner); }
  }
  function closeRename() {
    if (renameRef.current?.busy) return;
    setRenameSource(null);
    document.querySelector<HTMLButtonElement>(compact ? 'button[aria-label="Filter options"]' : 'button[aria-label="Project filter"]')?.focus();
    if (!renameRef.current?.started) { renameRef.current = null; setRenameOperation(null); }
  }
  function reviewRename() {
    if (bulkOwner.current) return;
    setRenameSource(null); setEditSuspended(true); setRemoving(null);
    void remote()?.review("tasks");
  }
  function abandonRename() {
    if (bulkOwner.current) return;
    renameRef.current = null; setRenameOperation(null); setRenameSource(null);
    setError("Rename retry stopped. Partial task and label changes remain; no changes were rolled back.");
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
          onRename={openRename}
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

      <AddForm serverLabels={serverLabels} onAdd={onAdd} compact={compact} rename={renameEvent} onProjectsChange={addProjects} />
      {renameOperation?.started && renameSource === null && <button type="button" onClick={() => setRenameSource(renameOperation.from)}>Review rename progress</button>}
      {editTask && editSuspended && <button type="button" onClick={() => setEditSuspended(false)}>Resume task draft</button>}

      <EditTaskModal
        task={editTask}
        suspended={editSuspended}
        serverLabels={serverLabels}
        onSave={onEditSave}
        onClose={() => setEditTask(null)}
        rename={renameEvent}
        onProjectsChange={editProjects}
      />

      <RemoveLabelDialog target={removing} onConfirm={confirmRemove} onCancel={() => setRemoving(null)} />
      <RenameProjectDialog source={renameSource} operation={renameOperation} count={tasks.filter((task) => task.projects.includes(renameSource ?? "")).length}
        onConfirm={(name) => { void confirmRename(name); }} onClose={closeRename} onReview={reviewRename} onAbandon={abandonRename} />
    </section>
  );
});

TodoPane.displayName = "TodoPane";
export default TodoPane;
