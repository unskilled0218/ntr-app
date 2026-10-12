// Edit modal for an existing task. Pre-populates the same structured fields as AddForm
// (description, priority, due, project). Hidden task metadata is retained on save.
// The task prop drives open/close: non-null
// opens the dialog; null closes it. Uses the same native-<dialog> pattern as LabelModal.

import { useEffect, useRef, useState } from "react";
import { errMsg, type Task } from "../api";
import { PRIORITY_OPTIONS } from "../config";
import { bareDescription, composeEditedTask, getTaskPriority } from "../labels";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";
import SelectField from "./SelectField";
import { useBackdropClose } from "./useBackdropClose";
import { ownDialogEvent } from "./dialogEvents";
import { formatLocalTaskDate } from "../lib/taskDates";

interface Props {
  task: Task | null;
  serverLabels: { project: string[]; context: string[] };
  onSave(id: number, text: string): Promise<void>;
  onClose(): void;
}

export default function EditTaskModal({ task, serverLabels, onSave, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<"project" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (task) {
      setDescription(bareDescription(task.description, task.projects, task.contexts, task.tags));
      setPriority(getTaskPriority(task));
      setDue(task.tags.due ?? "");
      setProject(task.projects[0] ?? "");
      setStaged([]);
      setModalKind(null);
      setError("");
      if (!el.open) el.showModal();
    } else {
      el.close();
    }
  }, [task]);

  const onConfirm = (name: string) => {
    setStaged((s) => [...new Set([...s, name])]);
    setProject(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || (!description.trim() && !task.contexts.length)) return;
    try {
      const text = composeEditedTask(task, { priority, description, project, due }, formatLocalTaskDate(new Date()));
      if (!text.trim()) return;
      await onSave(task.id, text);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function onCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    if (!ownDialogEvent(e)) return;
    e.preventDefault();
    onClose();
  }

  // Click outside the box closes it via onClose (not a raw dialog.close()), so the parent's `task`
  // state — the source of truth here — stays in step, exactly as Escape does.
  useBackdropClose(dialogRef, onClose);

  const priorityOptions = PRIORITY_OPTIONS.some((option) => option.value === priority)
    ? PRIORITY_OPTIONS
    : [...PRIORITY_OPTIONS, { value: priority, label: priority }];

  return (
    <dialog id="edit-task-modal" ref={dialogRef} onCancel={onCancel} onClose={ownDialogEvent}>
      <form id="edit-task-form" autoComplete="off" onSubmit={submit}>
        <h2>Edit task</h2>
        <label>
          Description
          <input
            type="text"
            aria-label="Task description"
            value={description}
            onChange={(e) => setDescription(e.currentTarget.value)}
          />
        </label>
        <div className="add-fields">
          <label>
            Priority
            <SelectField ariaLabel="Priority" value={priority} options={priorityOptions} onChange={setPriority} />
          </label>
          <label>
            Due
            <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.currentTarget.value)} />
          </label>
          <label>
            Project
            <LabelSelect
              kind="project"
              value={project}
              serverLabels={serverLabels.project}
              staged={staged}
              onChange={setProject}
              onAdd={() => setModalKind("project")}
            />
          </label>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
      <LabelModal kind={modalKind} onConfirm={(_, name) => onConfirm(name)} onClose={() => setModalKind(null)} />
    </dialog>
  );
}
