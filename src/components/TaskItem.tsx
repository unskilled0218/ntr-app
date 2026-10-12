// One task row: checkbox, priority/description/meta, Edit/Delete. Direct port of app.js
// taskElement; class names match style.css.

import type { Task } from "../api";
import { listDescription } from "../labels";
import { displayedTaskDates, type TaskDateMetadata } from "../lib/taskDates";

function renderMeta(task: Task, dates: TaskDateMetadata): string {
  const bits = task.projects.map((p) => `+${p}`);
  if (dates.due) bits.push(`due:${dates.due}`);
  if (task.creation_date) bits.push(`created:${task.creation_date}`);
  if (dates.updated) bits.push(`updated:${dates.updated}`);
  if (task.completion_date) bits.push(`done:${task.completion_date}`);
  return bits.join(" ");
}

interface Props {
  task: Task;
  onToggle: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

export default function TaskItem({ task, onToggle, onEdit, onDelete }: Props) {
  const dates = displayedTaskDates(task.tags);
  const meta = renderMeta(task, dates);
  return (
    <li className={"task" + (task.completed ? " completed" : "")}>
      <input type="checkbox" checked={task.completed} onChange={() => onToggle(task)} />
      <div className="body">
        <span className="text">
          {task.priority && <span className="priority">({task.priority})</span>}
          {/* Hide date tokens only when their effective value is displayed below. */}
          {listDescription(task.description, task.projects, task.contexts, dates) || "Task without description"}
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
