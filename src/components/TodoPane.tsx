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
  uncompleteTask,
  updateTask,
  type Task,
} from "../api";
import { sortTasks, STATUSES, type Status } from "../config";
import AddForm from "./AddForm";
import FilterBar from "./FilterBar";
import TaskItem from "./TaskItem";

export interface TodoPaneHandle {
  onTasksChanged: () => void;
}

type Labels = { project: string[]; context: string[] };

const TodoPane = forwardRef<TodoPaneHandle>((_, ref) => {
  const [status, setStatus] = useState<Status>("all");
  const [project, setProject] = useState("");
  const [context, setContext] = useState("");
  const [sort, setSort] = useState("file");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [serverLabels, setServerLabels] = useState<Labels>({ project: [], context: [] });
  const [error, setError] = useState("");

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

  // Rebuild the label sets from the labels currently in the store; drop a filter selection whose
  // label has disappeared (so the dropdown and the query never disagree). Mirrors app.js
  // loadLabels() + populateFilterSelect()'s "keep across reloads while it still exists" rule.
  // Stable (no project/context deps): a vanished filter is dropped via the functional setState
  // updater, which reads the latest value without closing over it — so this is created once and
  // is a correct dependency for the effect and the imperative handle below.
  const loadLabels = useCallback(async () => {
    let all: Task[];
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
    setServerLabels({ project: [...projects], context: [...contexts] });
    setProject((p) => (p && !projects.has(p) ? "" : p));
    setContext((c) => (c && !contexts.has(c) ? "" : c));
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

  async function onEdit(task: Task) {
    const next = window.prompt("Edit task (todo.txt syntax):", task.raw);
    if (next === null) return;
    const text = next.trim();
    if (!text) return;
    try {
      await updateTask(task.id, text);
      await refresh();
      await loadLabels();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  const sorted = sortTasks(tasks, sort);

  return (
    <section className="pane todo-pane" id="todo-view">
      <h1>todo</h1>

      <AddForm serverLabels={serverLabels} onAdd={onAdd} />

      <FilterBar
        status={status}
        project={project}
        context={context}
        sort={sort}
        serverLabels={serverLabels}
        onStatus={setStatus}
        onProject={setProject}
        onContext={setContext}
        onSort={setSort}
      />

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
    </section>
  );
});

TodoPane.displayName = "TodoPane";
export default TodoPane;
