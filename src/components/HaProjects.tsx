// HA list identity is routing metadata, never a todo.txt label token.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { captureTransport, errMsg, isTransportCurrent, manageHaList, recoverHaMove, type HaCatalog, type HaList } from "../api";
import SelectField from "./SelectField";
import { useBackdropClose } from "./useBackdropClose";
import { ownDialogEvent } from "./dialogEvents";

interface HaProjectsState { catalog: HaCatalog; disabled: boolean; open(action: "create" | "rename" | "delete", id?: string, onCreated?: (id:string) => void): void }
const HaProjectsContext = createContext<HaProjectsState | null>(null);
export const useHaProjects = () => useContext(HaProjectsContext);
export function haListLabel(list: HaList, lists: HaList[]) {
  return lists.filter((other) => other.name === list.name).length > 1 ? `${list.name} (${list.id})` : list.name;
}

export function ConfirmationDialog({ title, children, onCancel, onConfirm, busy = false, error = "", confirmLabel = "Confirm" }: {title: string; children: ReactNode; onCancel(): void; onConfirm(): void; busy?: boolean; error?: string; confirmLabel?: string}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  useBackdropClose(ref, () => { if (!busy) onCancel(); });
  return <dialog aria-label={title} ref={ref} onClose={ownDialogEvent} onCancel={(event) => { if (!ownDialogEvent(event)) return; event.preventDefault(); if (!busy) onCancel(); }}>
    <form onSubmit={(event) => { event.preventDefault(); event.stopPropagation(); if (!busy) onConfirm(); }}>
      <h2>{title}</h2>{children}
      {error && <p role="alert">{error}</p>}
      <div className="modal-actions"><button type="button" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" disabled={busy}>{busy ? "Working…" : confirmLabel}</button></div>
    </form>
  </dialog>;
}

export default function HaProjects({catalog, disabled, setCatalog, beforeMutation, onChanged, onDialogChange, children}: {catalog: HaCatalog | null; disabled: boolean; setCatalog(catalog: HaCatalog): void; beforeMutation(): boolean; onChanged(): void; onDialogChange?(open:boolean): void; children: ReactNode}) {
  const [prompt, setPrompt] = useState<{action:"create" | "rename" | "delete"; id:string; name:string; signature:string; owner:ReturnType<typeof captureTransport>; beforeIds:string[]; onCreated?: (id:string) => void} | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{action:"abandon" | "reconcile"; owner:ReturnType<typeof captureTransport>; signature:string} | null>(null);
  const signature = JSON.stringify(catalog);
  useEffect(() => { onDialogChange?.(!!prompt || !!recovery); }, [prompt, recovery, onDialogChange]);
  const currentSignature = useRef(signature); currentSignature.current = signature;
  function open(action: "create" | "rename" | "delete", id = "", onCreated?: (id:string) => void) {
    if (disabled || busy || !catalog) return;
    const list = catalog.lists.find((list) => list.id === id);
    setPrompt({action, id, name:list?.name ?? "", signature, owner:captureTransport(), beforeIds:catalog.lists.map((list) => list.id), onCreated});
    setName(list?.name ?? ""); setError("");
  }
  async function confirm() {
    if (!prompt || busy || disabled) return;
    if (!isTransportCurrent(prompt.owner) || currentSignature.current !== prompt.signature) { setError("List catalog or connection changed. Cancel and reopen confirmation."); return; }
    if (!beforeMutation()) return;
    setBusy(true); setError("");
    try {
      const result = await manageHaList(prompt.action, prompt.id, name.trim(), prompt.name, prompt.owner);
      if (isTransportCurrent(prompt.owner)) {
        setCatalog(result); setPrompt(null);
        const added = result.lists.filter((list) => !prompt.beforeIds.includes(list.id) && list.name === name.trim());
        if (prompt.action === "create" && added.length === 1) prompt.onCreated?.(added[0].id);
        onChanged();
      }
    } catch (error) { if (isTransportCurrent(prompt.owner)) { setError(`${errMsg(error)} Refresh and inspect HA before retrying an uncertain operation.`); onChanged(); } }
    finally { setBusy(false); }
  }
  async function recover() {
    if (!recovery || !catalog?.pending_move || disabled || busy || !beforeMutation()) return;
    const owner = recovery.owner;
    if (!isTransportCurrent(owner) || recovery.signature !== currentSignature.current) { setError("Move recovery or connection changed. Cancel and reopen confirmation."); return; }
    setBusy(true); setError("");
    try { const result = await recoverHaMove(recovery.action, catalog.pending_move.operation_id, owner); if (isTransportCurrent(owner)) { setCatalog(result); setRecovery(null); onChanged(); } }
    catch (error) { if (isTransportCurrent(owner)) setError(errMsg(error)); }
    finally { setBusy(false); }
  }
  const value = catalog ? {catalog, disabled:disabled || busy, open} : null;
  return <HaProjectsContext.Provider value={value}>
    {children}
    {catalog?.pending_move && <aside role="status">Unfinished move from {catalog.pending_move.source_list} to {catalog.pending_move.target_list}. Review both lists in HA; writes to these lists are blocked.
      <button disabled={disabled || busy} onClick={() => {setError(""); setRecovery({action:"reconcile", owner:captureTransport(), signature});}}>Reconcile completed move</button>
      <button disabled={disabled || busy} onClick={() => {setError(""); setRecovery({action:"abandon", owner:captureTransport(), signature});}}>Abandon move</button>
    </aside>}
    {prompt && <ConfirmationDialog title={prompt.action === "create" ? "Create HA list" : prompt.action === "rename" ? "Rename HA list" : "Delete HA list"} busy={busy} error={error} onCancel={() => setPrompt(null)} onConfirm={() => {void confirm();}}>
      {prompt.action === "delete" ? <p>Delete “{prompt.name}”? Only an empty Local To-do list can be deleted, including completed tasks. Stop other HA writers during deletion: HA cannot atomically check and delete. The default list is protected.</p>
        : <label>HA list name<input aria-label="HA list name" value={name} onChange={(event) => setName(event.currentTarget.value)} disabled={busy} /></label>}
    </ConfirmationDialog>}
    {recovery && <ConfirmationDialog title={recovery.action === "abandon" ? "Abandon HA move" : "Reconcile HA move"} busy={busy} error={error} onCancel={() => setRecovery(null)} onConfirm={() => {void recover();}}>
      <p>{recovery.action === "abandon" ? "Clear the move block without deleting or copying anything. Any retained copies remain separate tasks. Review both lists first." : "Verify that the source is absent and the target copy is intact, then repair identity metadata. This never repeats HA copy or deletion."}</p>
    </ConfirmationDialog>}
  </HaProjectsContext.Provider>;
}

export function HaListPicker({value, onChange, filter = false}: {value: string; onChange(value: string): void; filter?: boolean}) {
  const ha = useHaProjects();
  if (!ha) return null;
  const {catalog, disabled} = ha;
  const options = [
    ...(catalog.can_create && !disabled ? [{value:"__ha_create__", label:"+ Add project..."}] : []),
    {value:"", label:filter ? "All projects" : `Default: ${catalog.lists.find((l) => l.is_default)?.name ?? ""}`},
    ...catalog.lists.map((list) => ({value:list.id, label:haListLabel(list, catalog.lists), renamable:!disabled && list.can_rename, removable:!disabled && list.can_delete})),
  ];
  return <SelectField ariaLabel={filter ? "Project filter" : "Project"} value={value} options={options} onChange={(id) => {if (id === "__ha_create__") ha.open("create", "", onChange); else onChange(id);}}
    onRename={(id, session) => {session?.close(); ha.open("rename", id);}} onRemove={(id, session) => {session?.close(); ha.open("delete", id);}} />;
}
