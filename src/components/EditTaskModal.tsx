// Edit modal for an existing task. Pre-populates the same structured fields as AddForm
// (description, due, project). Hidden task metadata is retained on save.
// The task prop drives open/close: non-null
// opens the dialog; null closes it. Uses the same native-<dialog> pattern as LabelModal.

import { useEffect, useRef, useState } from "react";
import { captureTransport, destination, errMsg, type Task, type TaskRouting } from "../api";
import { ConfirmationDialog, useHaProjects } from "./HaProjects";
import { bareDescription, composeEditedTask, removeProjectText, renameProjectNames, renameProjectText } from "../labels";
import type { ProjectRenameEvent } from "../lib/projectRename";
import type { ProjectRemovalEvent } from "../lib/projectRemoval";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";
import { useBackdropClose } from "./useBackdropClose";
import { ownDialogEvent } from "./dialogEvents";
import { formatLocalTaskDate, dueDateInput, editedDue, isDueDatetime } from "../lib/taskDates";

interface Props {
  disabled?: boolean;
  task: Task | null;
  suspended?: boolean;
  serverLabels: { project: string[]; context: string[] };
  onSave(id: number, text: string, routing?: TaskRouting): Promise<void>;
  onClose(): void;
  rename?: ProjectRenameEvent;
  onProjectsChange?: (names: string[]) => void;
  removal?: ProjectRemovalEvent;
}

export default function EditTaskModal({ task, suspended, serverLabels, onSave, onClose, rename, onProjectsChange, removal, disabled = false }: Props) {
  const ha = useHaProjects();
  const [move, setMove] = useState<{text: string; routing: TaskRouting; signature: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [project, setProject] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<"project" | null>(null);
  const [error, setError] = useState("");
  const baseline = useRef(task);
  useEffect(() => {
    onProjectsChange?.(task ? [...new Set([...staged, project, ...description.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1))])].filter(Boolean) : []);
  }, [staged, project, description, task, onProjectsChange]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (task) {
      baseline.current = task;
      setDescription(bareDescription(task.description, task.list_id ? [] : task.projects, task.contexts, task.tags));
      setDue(dueDateInput(task.tags.due ?? ""));
      setDueTouched(false);
      setProject(task.list_id ?? task.projects[0] ?? "");
      setMove(null);
      setStaged([]);
      setModalKind(null);
      setError("");
    }
  }, [task]);
  useEffect(() => {
    if (!rename || rename.destination !== destination(captureTransport())) return;
    const previous = baseline.current;
    const updated = rename.tasks.find((found) => found.id === previous?.id);
    if (previous && updated && renameProjectText(previous.raw, rename.from, rename.to) === updated.raw) baseline.current = updated;
    setDescription((text) => renameProjectText(text, rename.from, rename.to));
    setProject((name) => name === rename.from ? rename.to : name);
    setStaged((names) => renameProjectNames(names, rename.from, rename.to));
  }, [rename]);
  useEffect(() => {
    if (!removal || removal.destination !== destination(captureTransport())) return;
    const previous = baseline.current;
    const updated = removal.tasks.find((found) => found.id === previous?.id);
    if (previous && updated && removeProjectText(previous.raw, removal.from) === updated.raw) baseline.current = updated;
    setDescription((text) => removeProjectText(text, removal.from));
    setProject((name) => name === removal.from ? "" : name);
    setStaged((names) => names.filter((name) => name !== removal.from));
  }, [removal]);
  useEffect(() => {
    const el = dialogRef.current!;
    if (task && !suspended && !el.open) el.showModal();
    else if ((!task || suspended) && el.open) el.close();
  }, [task, suspended]);

  const onConfirm = (name: string) => {
    setStaged((s) => [...new Set([...s, name])]);
    setProject(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const current = baseline.current;
    if (!task || !current || (!description.trim() && !current.contexts.length)) return;
    try {
      const text = composeEditedTask(current, { description, project, due: editedDue(current.tags.due ?? "", due, dueTouched) }, formatLocalTaskDate(new Date()));
      if (!text.trim()) return;
      if (task.list_id && ha) {
        const target = project || ha.catalog.lists.find((list) => list.is_default)?.id;
        if (!target) throw new Error("HA default list unavailable");
        const routing = {list_id:target, expected_source:task.list_id, expected_raw:current.raw};
        if (target !== task.list_id) { setError(""); setMove({text, routing:{...routing, confirm_move:true}, signature:JSON.stringify(ha.catalog)}); return; }
        await onSave(task.id, text, routing);
      } else await onSave(task.id, text);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function confirmMove() {
    if (!move || !task || !ha || saving || disabled) return;
    if (move.signature !== JSON.stringify(ha.catalog)) { setError("List catalog changed. Cancel and confirm the move again."); return; }
    setSaving(true); setError("");
    try { await onSave(task.id, move.text, move.routing); setMove(null); }
    catch (error) { setError(`${errMsg(error)} Review both lists and the pending-move notice before retrying.`); }
    finally { setSaving(false); }
  }

  function onCancel(e: React.SyntheticEvent<HTMLDialogElement>) {
    if (!ownDialogEvent(e)) return;
    e.preventDefault();
    onClose();
  }

  // Click outside the box closes it via onClose (not a raw dialog.close()), so the parent's `task`
  // state — the source of truth here — stays in step, exactly as Escape does.
  useBackdropClose(dialogRef, onClose);

  return (
    <><dialog id="edit-task-modal" ref={dialogRef} onCancel={onCancel} onClose={ownDialogEvent}>
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
            Due
            <input type="date" aria-label="Due date" value={due} onChange={(e) => { setDue(e.currentTarget.value); setDueTouched(true); }} />
            {isDueDatetime(task?.tags.due) && (!dueTouched || due) && <small>Time and fixed offset {task.tags.due.slice(11)} stay unchanged when changing the date.</small>}
            {(due || (!dueTouched && task?.tags.due)) && <button type="button" onClick={() => { setDue(""); setDueTouched(true); }}>Clear due</button>}
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
          <button type="submit" className="primary" disabled={disabled}>Save</button>
        </div>
      </form>
      <LabelModal kind={modalKind} onConfirm={(_, name) => onConfirm(name)} onClose={() => setModalKind(null)} />
    </dialog>
    {move && <ConfirmationDialog title="Move task to another HA list" busy={saving} error={error} onCancel={() => setMove(null)} onConfirm={() => {void confirmMove();}} confirmLabel="Move task">
      <p>Move from {ha?.catalog.lists.find((list) => list.id === task?.list_id)?.name ?? task?.list_id} to {ha?.catalog.lists.find((list) => list.id === move.routing.list_id)?.name ?? move.routing.list_id}? ntr copies and verifies the task before deleting its source. Stop other HA writers during the move. A failure can leave both copies and require recovery.</p>
    </ConfirmationDialog>}</>
  );
}
