// The add form: free-text description + priority/due/project/context controls, and the label-add
// modal it drives. Ported from #add-form + app.js (composeText, the label-select change handling,
// staging). Owns its own field state and the session's staged labels (labels created in the modal
// but not yet attached to any task; they persist for the session, exactly as app.js's module-level
// `staged` does).

import { useState } from "react";
import { ADD_VALUE, EMPTY_LABEL, KINDS, type Kind } from "../config";
import { composeText } from "../labels";
import LabelModal from "./LabelModal";

interface Props {
  serverLabels: { project: string[]; context: string[] };
  // Returns true on success (so the form resets) or false on error (kept for correction).
  onAdd: (text: string) => Promise<boolean>;
}

const PRIORITIES = ["A", "B", "C"];

export default function AddForm({ serverLabels, onAdd }: Props) {
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [context, setContext] = useState("");
  const [staged, setStaged] = useState<{ project: string[]; context: string[] }>({
    project: [],
    context: [],
  });
  const [modalKind, setModalKind] = useState<Kind | null>(null);

  // The option list for a label select: server labels ∪ session-staged, sorted. A select shows
  // only its None + add-entry until a label of that kind exists.
  const options = (kind: Kind) => [...new Set([...serverLabels[kind], ...staged[kind]])].sort();

  // A label select changed: the add-entry opens the modal (selection unchanged, so the prior pick
  // is naturally preserved); anything else is a normal pick.
  const onSelect = (kind: Kind, value: string, set: (v: string) => void) => {
    if (value === ADD_VALUE) {
      setModalKind(kind);
      return;
    }
    set(value);
  };

  // Modal confirmed: stage the new label, select it for its kind, close the modal.
  const onConfirm = (kind: Kind, name: string) => {
    setStaged((s) => ({ ...s, [kind]: [...new Set([...s[kind], name])] }));
    if (kind === "project") setProject(name);
    else setContext(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // A description is the one required field; without it an add is a no-op.
    if (!description.trim()) return;
    const text = composeText({ priority, description, project, context, due });
    const ok = await onAdd(text);
    if (ok) {
      setDescription("");
      setPriority("");
      setDue("");
      setProject("");
      setContext("");
    }
  }

  const labelSelect = (kind: Kind, value: string, set: (v: string) => void) => (
    <select
      aria-label={KINDS[kind].singular[0].toUpperCase() + KINDS[kind].singular.slice(1)}
      value={value}
      onChange={(e) => onSelect(kind, e.currentTarget.value, set)}
    >
      <option value={ADD_VALUE}>+ Add {KINDS[kind].singular}...</option>
      <option value="">{EMPTY_LABEL}</option>
      {options(kind).map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </select>
  );

  return (
    <form id="add-form" autoComplete="off" onSubmit={submit}>
      <div className="add-row">
        <input
          id="add-input"
          type="text"
          placeholder="Add a task, e.g. call bank"
          aria-label="New task"
          value={description}
          onChange={(e) => setDescription(e.currentTarget.value)}
        />
        <button type="submit">Add</button>
      </div>
      <div className="add-fields">
        <label>
          Priority
          <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.currentTarget.value)}>
            <option value="">{EMPTY_LABEL}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label>
          Due
          <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.currentTarget.value)} />
        </label>
        <label>
          Projects
          {labelSelect("project", project, setProject)}
        </label>
        <label>
          Contexts
          {labelSelect("context", context, setContext)}
        </label>
      </div>
      <LabelModal kind={modalKind} onConfirm={onConfirm} onClose={() => setModalKind(null)} />
    </form>
  );
}
