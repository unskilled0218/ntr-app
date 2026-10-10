// The add form: free-text description + priority/due/project controls, and the label-add
// modal it drives. Ported from #add-form + app.js (composeText, the label-select change handling,
// staging). Owns its own field state and the session's staged labels (labels created in the modal
// but not yet attached to any task; they persist for the session, exactly as app.js's module-level
// `staged` does).

import { useState } from "react";
import { PRIORITY_OPTIONS } from "../config";
import { composeText } from "../labels";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";
import OptionsModal from "./OptionsModal";
import SelectField from "./SelectField";

interface Props {
  serverLabels: { project: string[]; context: string[] };
  // Returns true on success (so the form resets) or false on error (kept for correction).
  onAdd: (text: string) => Promise<boolean>;
  compact: boolean; // when true, the fields collapse behind one "Options" button on the add row
}

export default function AddForm({ serverLabels, onAdd, compact }: Props) {
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("");
  const [due, setDue] = useState("");
  const [project, setProject] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<"project" | null>(null);

  // Modal confirmed: stage the new project, select it, and close the modal.
  const onConfirm = (name: string) => {
    setStaged((s) => [...new Set([...s, name])]);
    setProject(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    // A description is the one required field; without it an add is a no-op.
    if (!description.trim()) return;
    const text = composeText({ priority, description, project, contexts: [], due });
    const ok = await onAdd(text);
    if (ok) {
      setDescription("");
      setPriority("");
      setDue("");
      setProject("");
    }
  }

  // LabelModal is a sibling of the form, not a child: React dispatches submit along the React
  // tree, so a modal rendered inside <form id="add-form"> would bubble its "Add" submit into this
  // form's onSubmit (creating a stray task and clearing the just-picked label). Keeping it outside
  // matches EditTaskModal and the original web UI (server/web/index.html), where #label-modal is a
  // top-level sibling of #add-form.
  // The three field controls, defined once and rendered either inline (default) or inside the
  // compact Options modal — so their props and wiring live in exactly one place.
  const fields = (
    <>
      <label>
        Priority
        <SelectField ariaLabel="Priority" value={priority} options={PRIORITY_OPTIONS} onChange={setPriority} />
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
          staged={staged}
          onChange={setProject}
          onAdd={() => setModalKind("project")}
        />
      </label>
    </>
  );

  return (
    <>
      <form id="add-form" autoComplete="off" onSubmit={submit}>
        {!compact && <div className="add-fields">{fields}</div>}
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
          {compact && <OptionsModal ariaLabel="Task options">{fields}</OptionsModal>}
        </div>
      </form>
      <LabelModal kind={modalKind} onConfirm={(_, name) => onConfirm(name)} onClose={() => setModalKind(null)} />
    </>
  );
}
