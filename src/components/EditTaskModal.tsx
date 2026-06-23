// Edit modal for an existing task. Pre-populates the same structured fields as AddForm
// (description, priority, due, project, context). The task prop drives open/close: non-null
// opens the dialog; null closes it. Uses the same native-<dialog> pattern as LabelModal.

import { useEffect, useRef, useState } from "react";
import { errMsg, type Task } from "../api";
import { EMPTY_LABEL, PRIORITIES, type Kind } from "../config";
import { bareDescription, composeText } from "../labels";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";

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
  const [context, setContext] = useState("");
  const [staged, setStaged] = useState<{ project: string[]; context: string[] }>({ project: [], context: [] });
  const [modalKind, setModalKind] = useState<Kind | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (task) {
      setDescription(bareDescription(task.description, task.projects, task.contexts, task.tags));
      setPriority(task.priority ?? "");
      setDue(task.tags.due ?? "");
      setProject(task.projects[0] ?? "");
      setContext(task.contexts[0] ?? "");
      setStaged({ project: [], context: [] });
      setError("");
      el.showModal();
    } else {
      el.close();
    }
  }, [task]);

  const onConfirm = (kind: Kind, name: string) => {
    setStaged((s) => ({ ...s, [kind]: [...new Set([...s[kind], name])] }));
    if (kind === "project") setProject(name);
    else setContext(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!task || !description.trim()) return;
    const text = composeText({ priority, description, project, context, due });
    try {
      await onSave(task.id, text);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function onCancel(e: React.SyntheticEvent) {
    e.preventDefault();
    onClose();
  }

  return (
    <dialog id="edit-task-modal" ref={dialogRef} onCancel={onCancel}>
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
            <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.currentTarget.value)}>
              <option value="">{EMPTY_LABEL}</option>
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
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
              staged={staged.project}
              onChange={setProject}
              onAdd={() => setModalKind("project")}
            />
          </label>
          <label>
            Context
            <LabelSelect
              kind="context"
              value={context}
              serverLabels={serverLabels.context}
              staged={staged.context}
              onChange={setContext}
              onAdd={() => setModalKind("context")}
            />
          </label>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary">Save</button>
        </div>
      </form>
      <LabelModal kind={modalKind} onConfirm={onConfirm} onClose={() => setModalKind(null)} />
    </dialog>
  );
}
