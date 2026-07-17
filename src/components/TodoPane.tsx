// The todo pane: add form, filter/sort row, task list. Owns the filter/sort state, the fetched
// tasks, and the server-derived label sets. Ported from the #todo-view section + the task/list/
// filter logic of app.js. Exposes onTasksChanged() so App can drive it from a live `change` event.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import {
  completeTask,
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
import { sortTasks, STATUSES, type Direction, type Kind, type Status } from "../config";
import {
  getStatus,
  setStatus as persistStatus,
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

export interface TodoPaneHandle {
  onTasksChanged: () => void;
}

interface Props {
  compact: boolean; // collapse the add fields and filter choosers into "Options" modals
}

const TodoPane = forwardRef<TodoPaneHandle, Props>(({ compact }, ref) => {
  // Status / sort / direction are seeded from the local cache (lazy useState initializer runs once
  // on mount) and written back in their change handlers below, so the view options survive relaunch.
  const [status, setStatus] = useState<Status>(getStatus);
  const [project, setProject] = useState("");
  const [context, setContext] = useState("");
  const [sort, setSort] = useState(getSort);
  const [dir, setDir] = useState<Direction>(getDirection);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [serverLabels, setServerLabels] = useState<Labels>({ project: [], context: [] });
  const [error, setError] = useState("");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [removing, setRemoving] = useState<{ kind: Kind; name: string } | null>(null);

  // Fetch the list with the current filters. Status + the two label filters become query args
  // (sort is applied client-side at render). Mirrors app.js refresh() + buildQuery().
  const refresh = useCallback(async () => {
    setError("");
    try {
      const filter = {
        completed: STATUSES[status].completed,
        project: project || null,
        context: context || null,
      };
      setTasks(await listTasks(filter));
    } catch (err) {
      setError(`Could not load tasks: ${errMsg(err)}`);
    }
  }, [status, project, context]);

  // Merge task-derived labels into the remembered backend resource. A task mutation can grow this
  // set, but only explicit label removal shrinks it.
  // Stable (no project/context deps): a vanished filter is dropped via the functional setState
  // updater, which reads the latest value without closing over it — so this is created once and
  // is a correct dependency for the effect and the imperative handle below.
  const loadLabels = useCallback(async () => {
    let all: Task[];
    const remembered = await getLabels().catch(() => ({ project: [], context: [] }));
    try {
      all = await listTasks({});
    } catch (err) {
      setError(`Could not load label suggestions: ${errMsg(err)}`);
      return;
    }
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
    setContext((c) => (c && !merged.context.includes(c) ? "" : c));
    if (
      merged.project.length !== remembered.project.length ||
      merged.context.length !== remembered.context.length
    ) {
      await putLabels(merged).catch(() => {});
    }
  }, []);

  // Two reload paths only: a filter change refetches the list (refresh changes with the filters);
  // and the initial mount loads the labels. Live `change` events go through the imperative handle.
  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    loadLabels();
  }, [loadLabels]);

  useImperativeHandle(
    ref,
    () => ({
      onTasksChanged: () => {
        refresh();
        loadLabels();
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

  // Remove a project/context from the whole store: strip its token from every task that carries
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
      const field = kind === "project" ? "project" : "context";
      await putLabels({ ...remembered, [field]: remembered[field].filter((n) => n !== name) });
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
          status={status}
          project={project}
          context={context}
          sort={sort}
          dir={dir}
          compact={compact}
          serverLabels={serverLabels}
          onStatus={(s) => { setStatus(s); persistStatus(s); }}
          onProject={setProject}
          onContext={setContext}
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
