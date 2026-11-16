// Edit modal for an existing task. Pre-populates the same structured fields as AddForm
// (description, due, list). Hidden task metadata is retained on save.
// The task prop drives open/close: non-null
// opens the dialog; null closes it. Uses the same native-<dialog> pattern as LabelModal.

import { useEffect, useRef, useState } from "react";
import { captureTransport, destination, errMsg, type Task, type TaskRouting } from "../api";
import { ConfirmationDialog, useHaLists } from "./HaLists";
import { bareDescription, composeEditedTask, removeListText, renameListNames, renameListText } from "../labels";
import type { ListRenameEvent } from "../lib/listRename";
import type { ListRemovalEvent } from "../lib/listRemoval";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";
import { useBackdropClose } from "./useBackdropClose";
import { ownDialogEvent } from "./dialogEvents";
import { formatLocalTaskDate, dueDateInput, editedDue, isDueDatetime } from "../lib/taskDates";
import { ADD_VALUE } from "../config";
import type { ListSelectorSession } from "../lib/listActions";

interface Props {
  disabled?: boolean;
  task: Task | null;
  suspended?: boolean;
  serverLabels: { list: string[]; context: string[] };
  onSave(id: number, text: string, routing?: TaskRouting): Promise<void>;
  onClose(): void;
  rename?: ListRenameEvent;
  onListsChange?: (names: string[]) => void;
  removal?: ListRemovalEvent;
}

export default function EditTaskModal({ task, suspended, serverLabels, onSave, onClose, rename, onListsChange, removal, disabled = false }: Props) {
  const ha = useHaLists();
  const [move, setMove] = useState<{text: string; routing: TaskRouting; signature: string} | null>(null);
  const [saving, setSaving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [description, setDescription] = useState("");
  const [due, setDue] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [list, setList] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<"list" | null>(null);
  const addSession = useRef<ListSelectorSession | undefined>(undefined);
  const targetDestination = destination(captureTransport());
  useEffect(() => {
    setModalKind(null);
    return () => { addSession.current?.close(); addSession.current = undefined; };
  }, [task, suspended, targetDestination]);
  const [error, setError] = useState("");
  const baseline = useRef(task);
  useEffect(() => {
    onListsChange?.(task ? [...new Set([...staged, list, ...description.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1))])].filter(Boolean) : []);
  }, [staged, list, description, task, onListsChange]);

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (task) {
      baseline.current = task;
      setDescription(bareDescription(task.description, task.list_id ? [] : task.lists, task.contexts, task.tags));
      setDue(dueDateInput(task.tags.due ?? ""));
      setDueTouched(false);
      setList(task.list_id ?? task.lists[0] ?? "");
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
    if (previous && updated && renameListText(previous.raw, rename.from, rename.to) === updated.raw) baseline.current = updated;
    setDescription((text) => renameListText(text, rename.from, rename.to));
    setList((name) => name === rename.from ? rename.to : name);
    setStaged((names) => renameListNames(names, rename.from, rename.to));
  }, [rename]);
  useEffect(() => {
    if (!removal || removal.destination !== destination(captureTransport())) return;
    const previous = baseline.current;
    const updated = removal.tasks.find((found) => found.id === previous?.id);
    if (previous && updated && removeListText(previous.raw, removal.from) === updated.raw) baseline.current = updated;
    setDescription((text) => removeListText(text, removal.from));
    setList((name) => name === removal.from ? "" : name);
    setStaged((names) => names.filter((name) => name !== removal.from));
  }, [removal]);
  useEffect(() => {
    const el = dialogRef.current!;
    if (task && !suspended && !el.open) el.showModal();
    else if ((!task || suspended) && el.open) el.close();
  }, [task, suspended]);

  const onConfirm = (name: string) => {
    setStaged((s) => [...new Set([...s, name])]);
    setList(name);
    setModalKind(null);
    const session = addSession.current; addSession.current = undefined; session?.close();
  };
  function cancelAddList() {
    setModalKind(null);
    const session = addSession.current; addSession.current = undefined; session?.restore(ADD_VALUE);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    const current = baseline.current;
    if (!task || !current || (!description.trim() && !current.contexts.length)) return;
    try {
      const text = composeEditedTask(current, { description, list, due: editedDue(current.tags.due ?? "", due, dueTouched) }, formatLocalTaskDate(new Date()));
      if (!text.trim()) return;
      if (task.list_id && ha) {
        const target = list || ha.catalog.lists.find((list) => list.is_default)?.id;
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
    <><dialog className="app-modal" id="edit-task-modal" ref={dialogRef} onCancel={onCancel} onClose={ownDialogEvent}>
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
            List
            <LabelSelect
              kind="list"
              value={list}
              serverLabels={serverLabels.list}
              staged={staged}
              onChange={setList}
              onAdd={(session) => { addSession.current = session; setModalKind("list"); }}
            />
          </label>
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="submit" className="primary" disabled={disabled}>Save</button>
        </div>
      </form>
      <LabelModal kind={modalKind} onConfirm={(_, name) => onConfirm(name)} onClose={cancelAddList} />
    </dialog>
    {move && <ConfirmationDialog title="Move task to another HA list" busy={saving} error={error} onCancel={() => setMove(null)} onConfirm={() => {void confirmMove();}} confirmLabel="Move task">
      <p>Move from {ha?.catalog.lists.find((list) => list.id === task?.list_id)?.name ?? task?.list_id} to {ha?.catalog.lists.find((list) => list.id === move.routing.list_id)?.name ?? move.routing.list_id}? ntr copies and verifies the task before deleting its source. Stop other HA writers during the move. A failure can leave both copies and require recovery.</p>
    </ConfirmationDialog>}</>
  );
}
