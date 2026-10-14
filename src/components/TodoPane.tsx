// The todo pane: add form, filter/sort row, task list. Owns the filter/sort state, the fetched
// tasks, and the server-derived label sets. Ported from the #todo-view section + the task/list/
// filter logic of app.js. Exposes onTasksChanged() so App can drive it from a live `change` event.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  completeTask,
  captureTransport,
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
import { planLabelRemoval, unionLabels } from "../labels";
import AddForm from "./AddForm";
import FilterBar from "./FilterBar";
import RemoveLabelDialog from "./RemoveLabelDialog";
import TaskItem from "./TaskItem";
import { ResourceRefresh } from "../lib/resourceRefresh";

export interface TodoPaneHandle {
  onTasksChanged: () => void;
}

interface Props {
  compact: boolean; // collapse the add fields and filter choosers into "Options" modals
}

const TodoPane = forwardRef<TodoPaneHandle, Props>(({ compact }, ref) => {
  // Sort / direction are seeded from the local cache (lazy useState initializer runs once
  // on mount) and written back in their change handlers below, so the view options survive relaunch.
  const [project, setProject] = useState("");
  const [sort, setSort] = useState(getSort);
  const [dir, setDir] = useState<Direction>(getDirection);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [serverLabels, setServerLabels] = useState<Labels>({ project: [], context: [] });
  const [error, setError] = useState("");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [removing, setRemoving] = useState<{ kind: "project"; name: string } | null>(null);
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

  // Fetch active and completed tasks with the current project filter
  // (sort is applied client-side at render). Mirrors app.js refresh() + buildQuery().
  const refresh = useCallback(async () => {
    const context = captureTransport();
    const request = ++tasksRequest.current;
    const current = () => mounted.current && request === tasksRequest.current && isTransportCurrent(context);
    try {
      const filter = {
        project: project || null,
      };
      const found = await listTasks(filter, context);
      if (current()) {
        setTasks(found);
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
  }, [project]);

  // Merge task-derived labels into the remembered backend resource. A task mutation can grow this
  // set, but only explicit label removal shrinks it.
  // Stable (no project deps): a vanished filter is dropped via the functional setState
  // updater, which reads the latest value without closing over it — so this is created once and
  // is a correct dependency for the effect and the imperative handle below.
  const loadLabels = useCallback(async () => {
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
      all = await listTasks({}, context);
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
      !labelsFailed && (merged.project.length !== remembered.project.length ||
      merged.context.length !== remembered.context.length)
    ) {
      await putLabels(merged, context).catch(() => {});
    }
    return !labelsFailed;
  }, []);

  const readers = useRef({ refresh, loadLabels });
  readers.current = { refresh, loadLabels };
  if (!recovery.current) recovery.current = new ResourceRefresh(async () => {
    const results = await Promise.all([readers.current.refresh(), readers.current.loadLabels()]);
    if (results.includes(false)) throw new Error("Task recovery pending");
  }, { canRun: () => mounted.current && isTransportCurrent(recoveryContext.current), onError: () => {} });

  function requestTasks() {
    if (!isTransportCurrent(recoveryContext.current)) {
      recovery.current!.cancel();
      recoveryContext.current = captureTransport();
      readErrors.current = { tasks: "", labels: "" };
      knownLabels.current = { project: [], context: [] };
    }
    recovery.current!.request();
  }

  // Initial/filter reads and live events share per-resource recovery. A newer
  // request or transport invalidates old responses without clearing visible data.
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
    }),
    [refresh, loadLabels],
  );

  async function onAdd(text: string): Promise<boolean> {
    try {
      await createTask(text);
      await refresh();
      await loadLabels();
      return true;
    } catch (err) {
      setError(errMsg(err));
      return false;
    }
  }

  async function onToggle(task: Task) {
    try {
      await (task.completed ? uncompleteTask(task.id) : completeTask(task.id));
      await refresh();
    } catch (err) {
      setError(errMsg(err));
      await refresh();
    }
  }

  async function onDelete(task: Task) {
    try {
      await apiDeleteTask(task.id);
      await refresh();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function onEdit(task: Task) {
    setEditTask(task);
  }

  // Remove a project from the whole store: strip its token from every task that carries
  // it. Fetch the full list (not the filtered view) so removal spans every task, including
  // completed ones; update each affected task sequentially (the file-backed, one-writer model);
  // then reload. loadLabels then drops the now-unused name and clears a filter that selected it.
  async function confirmRemove() {
    if (!removing) return;
    const { kind, name } = removing;
    setRemoving(null);
    try {
      const all = await listTasks({});
      for (const u of planLabelRemoval(all, kind, name)) await updateTask(u.id, u.text);
      const remembered = await getLabels().catch(() => ({ project: [], context: [] }));
      await putLabels({ ...remembered, project: remembered.project.filter((n) => n !== name) });
      await refresh();
      await loadLabels();
    } catch (err) {
      // Reload first to reflect whatever landed before the failure, then set the error LAST:
      // refresh() clears the error at its start, so setting it after the reload keeps the
      // message visible (unlike onToggle, where the trailing refresh would wipe it).
      await refresh();
      await loadLabels();
      setError(errMsg(err));
    }
  }

  async function onEditSave(id: number, text: string) {
    await updateTask(id, text); // throws on error → caught by EditTaskModal
    setEditTask(null);
    await refresh();
    await loadLabels();
  }

  const sorted = sortTasks(tasks, sort, dir);

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
        />
      </div>
      
      <div className="task-list">
        <ul id="tasks">
          {sorted.map((task) => (
            <TaskItem key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
        <p id="empty" hidden={tasks.length !== 0}>
          No tasks.
        </p>
        <p id="error" role="alert" hidden={!error}>
          {error}
        </p>
      </div>

      <AddForm serverLabels={serverLabels} onAdd={onAdd} compact={compact} />

      <EditTaskModal
        task={editTask}
        serverLabels={serverLabels}
        onSave={onEditSave}
        onClose={() => setEditTask(null)}
      />

      <RemoveLabelDialog target={removing} onConfirm={confirmRemove} onCancel={() => setRemoving(null)} />
    </section>
  );
});

TodoPane.displayName = "TodoPane";
export default TodoPane;
