// One task row: checkbox, priority/description/meta, Edit/Delete. Direct port of app.js
// taskElement; class names match style.css.

import type { Task } from "../api";
import { bareDescription } from "../labels";

function renderMeta(task: Task): string {
  const bits: string[] = [];
  if (task.creation_date) bits.push(`created ${task.creation_date}`);
  if (task.completion_date) bits.push(`done ${task.completion_date}`);
  if (task.projects.length) bits.push(task.projects.map((p) => `+${p}`).join(" "));
  return bits.join(" · ");
}

interface Props {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export default function TaskItem({ task, onToggle, onEdit, onDelete }: Props) {
  const meta = renderMeta(task);
  return (
    <li className={"task" + (task.completed ? " completed" : "")}>
      <input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} />
      <div className="body">
        <span className="text">
          {task.priority && <span className="priority">({task.priority})</span>}
          {/* List rows retain tags; only the edit form strips those structured tokens. */}
          {bareDescription(task.description, task.projects, task.contexts, {}) || "Task without description"}
        </span>
        {meta && <span className="meta">{meta}</span>}
      </div>
      <div className="task-actions">
        <button type="button" onClick={() => onEdit(task)}>
          Edit
        </button>
        <button type="button" onClick={() => onDelete(task)}>
          Delete
        </button>
      </div>
    </li>
  );
}
