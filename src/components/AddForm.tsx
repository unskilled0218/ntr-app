// The add form: free-text description + due/list controls, and the label-add
// modal it drives. Ported from #add-form + app.js (composeText, the label-select change handling,
// staging). Owns its own field state and the session's staged labels (labels created in the modal
// but not yet attached to any task; they persist for the session, exactly as app.js's module-level
// `staged` does).

import { useEffect, useRef, useState } from "react";
import { captureTransport, destination, errMsg } from "../api";
import { composeText, parseLabelInput, removeListText, renameListNames, renameListText } from "../labels";
import type { ListRenameEvent } from "../lib/listRename";
import type { ListRemovalEvent } from "../lib/listRemoval";
import type { ListActionRequest, ListManagement, ListSelectorSession } from "../lib/listActions";
import RenameListDialog from "./RenameListDialog";
import RemoveLabelDialog from "./RemoveLabelDialog";
import LabelModal from "./LabelModal";
import LabelSelect from "./LabelSelect";
import { useHaLists } from "./HaLists";
import OptionsModal, { type OptionsModalHandle } from "./OptionsModal";

interface Props {
  disabled?: boolean;
  serverLabels: { list: string[]; context: string[] };
  // Returns true on success (so the form resets) or false on error (kept for correction).
  onAdd: (text: string, listId?: string) => Promise<boolean>;
  compact: boolean; // when true, the fields collapse behind one "Options" button on the add row
  rename?: ListRenameEvent;
  onListsChange?: (names: string[]) => void;
  removal?: ListRemovalEvent;
  management?: ListManagement;
}

export default function AddForm({ serverLabels, onAdd, compact, rename, onListsChange, removal, management, disabled = false }: Props) {
  const ha = useHaLists();
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [due, setDue] = useState("");
  const [list, setList] = useState("");
  const [staged, setStaged] = useState<string[]>([]);
  const [modalKind, setModalKind] = useState<"list" | null>(null);
  const optionsRef = useRef<OptionsModalHandle>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [draftAction, setDraftAction] = useState<{ request: ListActionRequest; signature: string } | null>(null);
  const signature = JSON.stringify([description, list, staged]);
  const [mappedRevision, setMappedRevision] = useState(0);
  const activeSession = useRef<ListSelectorSession | undefined>(undefined);
  useEffect(() => () => { activeSession.current?.close(); activeSession.current = undefined; }, [compact, management?.destination]);
  useEffect(() => {
    onListsChange?.([...new Set([...staged, list, ...description.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1))])].filter(Boolean));
  }, [staged, list, description, onListsChange]);
  useEffect(() => {
    if (!rename || rename.destination !== destination(captureTransport())) return;
    setDescription((text) => renameListText(text, rename.from, rename.to));
    setList((name) => name === rename.from ? rename.to : name);
    setStaged((names) => renameListNames(names, rename.from, rename.to));
    setMappedRevision(rename.id);
  }, [rename]);
  useEffect(() => {
    if (!removal || removal.destination !== destination(captureTransport())) return;
    setDescription((text) => removeListText(text, removal.from));
    setList((name) => name === removal.from ? "" : name);
    setStaged((names) => names.filter((name) => name !== removal.from));
  }, [removal]);

  function restoreFocus() {
    formRef.current?.querySelector<HTMLButtonElement>(compact ? 'button[aria-label="Task options"]' : 'button[aria-label="List"]')?.focus();
  }
  function ownSession(picker?: ListSelectorSession) {
    const session = picker ? {
      restore: picker.restore,
      close() {
        const closed = picker.close();
        if (closed) optionsRef.current?.close();
        return closed;
      },
    } : undefined;
    activeSession.current = session;
    return session;
  }
  function listAction(request: ListActionRequest) {
    const session = ownSession(request.session);
    request = { ...request, session };
    if (management?.onAction(request)) return;
    if (request.scope !== "staged") return;
    if (request.action === "remove") session?.close();
    setError(""); setDraftAction({ request, signature });
  }
  function closeDraftAction(name?: string) {
    const request = draftAction?.request;
    setDraftAction(null); setError("");
    if (request?.action === "rename" && request.session) request.session.restore(name ?? request.name);
    else restoreFocus();
  }
  function confirmDraftAction(target?: string) {
    if (!draftAction) return;
    const { request } = draftAction;
    if (request.destination !== destination(captureTransport())) { setError("The destination changed. Reopen the list selector before acting."); return; }
    if (management?.onAction(request)) { setDraftAction(null); return; }
    if (serverLabels.list.includes(request.name) || !staged.includes(request.name) || signature !== draftAction.signature) {
      setError("List scope or draft changed. Cancel and reopen the selector for a new confirmation."); return;
    }
    let renamedName: string | undefined;
    if (request.action === "rename") {
      const parsed = parseLabelInput(target ?? "");
      if ("error" in parsed) { setError(parsed.error); return; }
      if (parsed.name === request.name) { closeDraftAction(); return; }
      if (management?.pending.some((record) => record.destination === request.destination && (record.from === parsed.name || record.to === parsed.name))) {
        setError("That name belongs to an unfinished list operation. Finish or stop its retry before using it here."); return;
      }
      const names = [...serverLabels.list, ...staged, ...description.split(/\s+/).filter((token) => token.startsWith("+")).map((token) => token.slice(1))];
      if (names.includes(parsed.name)) { setError("That list already exists. Renaming cannot merge lists."); return; }
      renamedName = parsed.name;
      setStaged((names) => renameListNames(names, request.name, parsed.name));
      setList((name) => name === request.name ? parsed.name : name);
      setDescription((text) => renameListText(text, request.name, parsed.name));
    } else {
      setStaged((names) => names.filter((name) => name !== request.name));
      setList((name) => name === request.name ? "" : name);
      setDescription((text) => removeListText(text, request.name));
    }
    closeDraftAction(renamedName);
  }

  // Modal confirmed: stage the new list, select it, and close the modal.
  const onConfirm = (name: string) => {
    setStaged((s) => [...new Set([...s, name])]);
    setList(name);
    setModalKind(null);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    // A description is the one required field; without it an add is a no-op.
    if (!description.trim()) return;
    setError("");
    let text: string;
    try {
      text = composeText({ description, list:ha ? "" : list, contexts: [], due });
    } catch (err) {
      setError(errMsg(err));
      return;
    }
    const ok = await (ha ? onAdd(text, list) : onAdd(text));
    if (ok) {
      setDescription("");
      setDue("");
      setList("");
    }
  }

  // LabelModal is a sibling of the form, not a child: React dispatches submit along the React
  // tree, so a modal rendered inside <form id="add-form"> would bubble its "Add" submit into this
  // form's onSubmit (creating a stray task and clearing the just-picked label). Keeping it outside
  // matches EditTaskModal and the original web UI (server/web/index.html), where #label-modal is a
  // top-level sibling of #add-form.
  // The field controls, defined once and rendered either inline (default) or inside the
  // compact Options modal — so their props and wiring live in exactly one place.
  const fields = (
    <>
      <label>
        Due
        <input type="date" aria-label="Due date" value={due} onChange={(e) => setDue(e.currentTarget.value)} />
      </label>
      <label>
        Lists
        <LabelSelect
          kind="list"
          value={list}
          serverLabels={serverLabels.list}
          staged={staged}
          onChange={setList}
          onAdd={() => setModalKind("list")}
          management={management}
          revision={mappedRevision}
          onListAction={management && !disabled ? listAction : undefined}
          onRecover={(id, picker) => {
            management?.onRecover(id, "add", ownSession(picker));
          }}
        />
      </label>
    </>
  );

  return (
    <>
      <form ref={formRef} id="add-form" autoComplete="off" onSubmit={submit}>
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
           <button type="submit" disabled={disabled}>Add</button>
          {compact && <OptionsModal ref={optionsRef} ariaLabel="Task options">{fields}</OptionsModal>}
        </div>
        {error && <p className="modal-error" role="alert">{error}</p>}
      </form>
      <LabelModal kind={modalKind} onConfirm={(_, name) => onConfirm(name)} onClose={() => setModalKind(null)} />
      <RenameListDialog id="draft-rename-list-dialog" scope="draft" source={draftAction?.request.action === "rename" ? draftAction.request.name : null}
        operation={null} error={error} onConfirm={(name) => confirmDraftAction(name)} onClose={closeDraftAction} onReview={() => {}} onAbandon={() => {}} />
      <RemoveLabelDialog id="draft-remove-list-dialog" scope="draft" target={draftAction?.request.action === "remove" ? { kind: "list", name: draftAction.request.name } : null}
        error={error} onConfirm={() => confirmDraftAction()} onCancel={closeDraftAction} />
    </>
  );
}
