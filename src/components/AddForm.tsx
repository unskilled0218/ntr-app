// The add form: free-text description + priority/due/project/context controls, and the label-add
// modal it drives. Ported from #add-form + app.js (composeText, the label-select change handling,
// staging). Owns its own field state and the session's staged labels (labels created in the modal
// but not yet attached to any task; they persist for the session, exactly as app.js's module-level
// `staged` does).

import { useState } from "react";
import { EMPTY_LABEL, PRIORITIES, type Kind } from "../config";
import { composeText } from "../labels";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";

interface Props {
  serverLabels: { project: string[]; context: string[] };
  // Returns true on success (so the form resets) or false on error (kept for correction).
  onAdd: (text: string) => Promise<boolean>;
}

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

  // LabelModal is a sibling of the form, not a child: React dispatches submit along the React
  // tree, so a modal rendered inside <form id="add-form"> would bubble its "Add" submit into this
  // form's onSubmit (creating a stray task and clearing the just-picked label). Keeping it outside
  // matches EditTaskModal and the original web UI (server/web/index.html), where #label-modal is a
  // top-level sibling of #add-form.
  return (
    <>
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
            Contexts
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
      </form>
      <LabelModal kind={modalKind} onConfirm={onConfirm} onClose={() => setModalKind(null)} />
    </>
  );
}
