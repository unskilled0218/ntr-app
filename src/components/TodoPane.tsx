// The todo pane: add form, filter/sort row, task list. Owns the filter/sort state, the fetched
// tasks, and the server-derived label sets. Ported from the #todo-view section + the task/list/
// filter logic of app.js. Exposes onTasksChanged() so App can drive it from a live `change` event.

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  completeTask,
  captureTransport,
  destination,
  isTransportCurrent,
  canMutate,
  markResourceReady,
  deleteTask as apiDeleteTask,
  errMsg,
  listTasks,
  createTask,
  getLabels,
  putLabels,
  getHaCatalog,
  type HaCatalog,
  type TaskRouting,
  uncompleteTask,
  updateTask,
  type Task,
  type Labels,
} from "../api";
import EditTaskModal from "./EditTaskModal";
import HaLists from "./HaLists";
import { sortTasks, type Direction } from "../config";
import {
  clearLegacyTodoPreferences,
  getSort,
  setSort as persistSort,
  getDirection,
  setDirection as persistDir,
} from "../settings";
import { parseLabelInput, removeListText, renameListText, unionLabels } from "../labels";
import AddForm from "./AddForm";
import FilterBar from "./FilterBar";
import RemoveLabelDialog from "./RemoveLabelDialog";
import TaskItem from "./TaskItem";
import { ResourceRefresh } from "../lib/resourceRefresh";
import type { ApplicationToken, RemoteUpdates } from "../lib/remoteUpdates";
import RenameListDialog from "./RenameListDialog";
import { ListRename, ListReviewRequired, listRenameIO, type ListRenameEvent } from "../lib/listRename";
import type { TransportContext } from "../api";
import { ListRemoval, type ListRemovalEvent } from "../lib/listRemoval";
import type { ListActionRequest, ListManagement, ListOrigin, ListRecovery, ListSelectorSession } from "../lib/listActions";

type ListRecord = { id: number; kind: "rename"; operation: ListRename } | { id: number; kind: "remove"; operation: ListRemoval };

export interface TodoPaneHandle {
  onTasksChanged: () => void;
  onCatalogChanged: () => void;
  applyRemote: (token: ApplicationToken<"tasks">) => Promise<boolean>;
  reviewRemote: () => void;
}

interface Props {
  disabled?: boolean;
  compact: boolean; // collapse the add fields and filter choosers into "Options" modals
  updates?: RemoteUpdates;
  onDialogChange?: (open: boolean) => void;
}

const TodoPane = forwardRef<TodoPaneHandle, Props>(({ compact, updates, onDialogChange, disabled = false }, ref) => {
  // Sort / direction are seeded from the local cache (lazy useState initializer runs once
  // on mount) and written back in their change handlers below, so the view options survive relaunch.
  const [list, setList] = useState("");
  const [sort, setSort] = useState(getSort);
  const [dir, setDir] = useState<Direction>(getDirection);
  const [tasks, setTasks] = useState<Task[]>([]);
  const taskProjection = useRef(tasks);
  const projectionOwner = useRef(captureTransport());
  const addOwner = useRef(captureTransport());
  const projectTasks = (found: Task[]) => { taskProjection.current = found; setTasks(found); };
  const remote = () => captureTransport().url ? updates : undefined;
  const [serverLabels, setServerLabels] = useState<Labels>({ list: [], context: [] });
  const [haCatalog, setHaCatalog] = useState<HaCatalog | null>(null);
  const [catalogBlocked, setCatalogBlocked] = useState(false);
  const catalogOwner = useRef(captureTransport());
  const [haDialog, setHaDialog] = useState(false);
  const [error, setError] = useState("");
  const [editTask, setEditTask] = useState<Task | null>(null);
  const editOwner = useRef(captureTransport());
  const editExpected = useRef<Task | null>(null);
  const [editSuspended, setEditSuspended] = useState(false);
  const [removing, setRemoving] = useState<{ kind: "list"; name: string } | null>(null);
  const [renameSource, setRenameSource] = useState<string | null>(null);
  const [renameOperation, setRenameOperation] = useState<ListRename | null>(null);
  const [removeOperation, setRemoveOperation] = useState<ListRemoval | null>(null);
  const records = useRef(new Map<string, ListRecord>());
  const displayedRecord = useRef<ListRecord | null>(null);
  const promptContext = useRef(captureTransport());
  const promptOrigin = useRef<ListOrigin>("filter");
  const promptSession = useRef<ListSelectorSession | undefined>(undefined);
  const [listNotice, setListNotice] = useState("");
  const [renameEvent, setRenameEvent] = useState<ListRenameEvent>();
  const [removalEvent, setRemovalEvent] = useState<ListRemovalEvent>();
  const renameSequence = useRef(0);
  const [, redraw] = useState(0);
  const bulkOwner = useRef<TransportContext | null>(null);
  const queuedRefresh = useRef(false);
  const draftLists = useRef({ add: [] as string[], edit: [] as string[] });
  const addLists = useCallback((names: string[]) => { draftLists.current.add = names; }, []);
  const editLists = useCallback((names: string[]) => { draftLists.current.edit = names; }, []);
  useEffect(() => { onDialogChange?.(haDialog || (!!editTask && !editSuspended) || !!removing || renameSource !== null); }, [haDialog, editTask, editSuspended, removing, renameSource, onDialogChange]);
  const mounted = useRef(false);
  const tasksRequest = useRef(0);
  const labelsRequest = useRef(0);
  const readErrors = useRef({ tasks: "", labels: "" });
  const knownLabels = useRef(serverLabels);
  knownLabels.current = serverLabels;
  const recoveryContext = useRef(captureTransport());
  const recovery = useRef<ResourceRefresh | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      tasksRequest.current++;
      labelsRequest.current++;
      recovery.current?.cancel();
    };
  }, []);

  // Initial/local reads fetch all active and completed tasks. List filtering and sorting
  // derive from this accepted projection at render; subsequent server reads only detect changes.
  const refresh = useCallback(async () => {
    const context = captureTransport();
    const request = ++tasksRequest.current;
    const current = () => mounted.current && request === tasksRequest.current && isTransportCurrent(context);
    if (context.url && updates?.accepted("tasks") !== undefined) {
      if (destination(projectionOwner.current) === destination(context)) projectionOwner.current = context;
      updates.request("tasks");
      return true;
    }
    try {
      const found = await listTasks({}, context);
      if (current()) {
        if (context.url && updates) updates.register("tasks", found);
        projectTasks(context.url && updates ? updates.accepted("tasks")! : found);
        projectionOwner.current = context;
        readErrors.current.tasks = "";
        setError(readErrors.current.labels);
      }
      return true;
    } catch (err) {
      if (current()) {
        readErrors.current.tasks = `Could not load tasks: ${errMsg(err)}`;
        setError(readErrors.current.tasks);
      }
      return !current();
    }
  }, [updates]);

  // Merge task-derived labels into the remembered backend resource. A task mutation can grow this
  // set, but only explicit label removal shrinks it.
  // Stable (no list deps): a vanished filter is dropped via the functional setState
  // updater, which reads the latest value without closing over it — so this is created once and
  // is a correct dependency for the effect and the imperative handle below.
  const loadLabels = useCallback(async (persist = false) => {
    const context = captureTransport();
    const request = ++labelsRequest.current;
    const current = () => mounted.current && request === labelsRequest.current && isTransportCurrent(context);
    let all: Task[];
    let remembered: Labels;
    let labelsFailed = false;
    let labelError = "";
    let catalog: HaCatalog | null;
    try {
      catalog = await getHaCatalog(context);
      if (!current()) return true;
      setHaCatalog(catalog); setCatalogBlocked(false); catalogOwner.current = context;
      remembered = await getLabels(context).catch((error) => {
        labelsFailed = true;
        labelError = `Could not load label suggestions: ${errMsg(error)}`;
        return knownLabels.current;
      });
      if (!current()) return true;
      all = taskProjection.current;
    } catch (err) {
      if (current()) {
        setCatalogBlocked(true);
        readErrors.current.labels = `Could not load label suggestions: ${errMsg(err)}`;
        setError(readErrors.current.tasks || readErrors.current.labels);
      }
      return !current();
    }
    if (!current()) return true;
    readErrors.current.labels = labelError;
    setError(readErrors.current.tasks || labelError);
    const lists = new Set<string>();
    const contexts = new Set<string>();
    for (const t of all) {
      for (const p of t.lists) lists.add(p);
      for (const c of t.contexts) contexts.add(c);
    }
    const merged: Labels = {
      list: catalog ? catalog.lists.map((list) => list.id) : unionLabels(remembered.list, [...lists]),
      context: unionLabels(remembered.context, [...contexts]),
    };
    setServerLabels(merged);
    if (!labelsFailed && isTransportCurrent(projectionOwner.current) && !readErrors.current.tasks) markResourceReady("tasks", context);
    setList((p) => (p && !merged.list.includes(p) ? "" : p));
    if (
      !catalog && (persist || !context.url) && !labelsFailed && (merged.list.length !== remembered.list.length ||
      merged.context.length !== remembered.context.length)
    ) {
      await putLabels(merged, context).catch(() => {});
    }
    return !labelsFailed;
  }, []);

  const readers = useRef({ refresh, loadLabels });
  readers.current = { refresh, loadLabels };
  if (!recovery.current) recovery.current = new ResourceRefresh(async () => {
    const results = [await readers.current.refresh(), await readers.current.loadLabels()];
    if (results.includes(false)) throw new Error("Task recovery pending");
  }, { canRun: () => mounted.current && isTransportCurrent(recoveryContext.current), onError: () => {} });

  function requestTasks() {
    if (bulkOwner.current && isTransportCurrent(bulkOwner.current)) { queuedRefresh.current = true; return; }
    if (!isTransportCurrent(recoveryContext.current)) {
      recovery.current!.cancel();
      recoveryContext.current = captureTransport();
      readErrors.current = { tasks: "", labels: "" };
      knownLabels.current = { list: [], context: [] };
    }
    recovery.current!.request();
  }

  // Initial/local reads and recovery share one resource runner. A newer request or transport
  // invalidates old responses without clearing visible data; filters never start a remote read.
  useEffect(() => {
    requestTasks();
  }, [refresh]);

  useEffect(() => {
    clearLegacyTodoPreferences();
  }, [loadLabels]);

  useImperativeHandle(
    ref,
    () => ({
      onCatalogChanged: () => { void loadLabels(); },
      onTasksChanged: () => {
        requestTasks();
      },
      applyRemote: async (token) => {
        if (!updates || haDialog || (editTask && !editSuspended) || removing || bulkOwner.current || renameSource !== null) {
          updates?.defer("tasks");
          setError("Close the task dialog, then review the update. Your draft is unchanged.");
          return false;
        }
        try {
          const owner = captureTransport();
          const labels = await getLabels(owner);
          return updates.commit(token, (snapshot) => {
            projectTasks(snapshot);
            setServerLabels({
              list: unionLabels(labels.list, snapshot.flatMap((task) => task.lists)),
              context: unionLabels(labels.context, snapshot.flatMap((task) => task.contexts)),
            });
            setError("");
          });
        } catch (error) {
          if (updates.valid(token)) updates.fail("tasks", `Could not load update: ${errMsg(error)}`);
          return false;
        }
      },
      reviewRemote: () => { if (bulkOwner.current) return; setEditSuspended(true); setRemoving(null); setRenameSource(null); },
    }),
    [refresh, loadLabels, updates, haDialog, editTask, editSuspended, removing, renameSource],
  );

  function safeAction() {
    if (catalogBlocked || !isTransportCurrent(catalogOwner.current)) { setError("Refresh the list catalog before making changes."); return false; }
    if (!canMutate("tasks") || !isTransportCurrent(projectionOwner.current)) { setError("Destination is still loading. Choose the action again when ready."); return false; }
    if (bulkOwner.current) { setError("Wait for the list operation to stop before changing tasks."); return false; }
    if (!remote() || (remote()!.accepted("tasks") !== undefined && !remote()!.blocked("tasks"))) return true;
    setEditSuspended(true);
    setRemoving(null);
    void remote()!.review("tasks");
    setError("Review the task update before using task IDs. Choose the action again after updating.");
    return false;
  }
  async function mutate(action: () => Promise<Task | void>, removeId?: number, owner = captureTransport(), persistLabels = true) {
    const settle = remote()?.begin("tasks");
    try {
      const task = await action();
      if (!isTransportCurrent(owner) || !mounted.current) { settle?.(); return task; }
      const known = remote()?.accepted("tasks") ?? taskProjection.current;
      const next = task ? (known.some((t) => t.id === task.id)
        ? known.map((t) => t.id === task.id ? task : t) : [...known, task]) : known.filter((t) => t.id !== removeId);
      settle?.(next);
      projectTasks(next);
      if (!persistLabels) setServerLabels((labels) => ({ list: unionLabels(labels.list, next.flatMap((found) => found.lists)), context: unionLabels(labels.context, next.flatMap((found) => found.contexts)) }));
      if (persistLabels) await loadLabels(true);
      return task;
    } catch (error) { settle?.(); throw error; }
  }

  async function onAdd(text: string, listId?: string): Promise<boolean> {
    const owner = captureTransport();
    try {
      if (!canMutate("tasks") || !isTransportCurrent(projectionOwner.current)) throw new Error("Destination is still loading.");
      if (catalogBlocked || !isTransportCurrent(catalogOwner.current)) throw new Error("Refresh the list catalog before making changes.");
      if (destination(addOwner.current) !== destination(captureTransport())) {
        addOwner.current = captureTransport();
        throw new Error("The destination changed. Submit again to add this draft to the current destination.");
      }
      if (bulkOwner.current) throw new Error("Wait for the list operation to stop before adding tasks.");
      guardDraft(text);
      await mutate(() => listId === undefined ? createTask(text) : createTask(text, {list_id:listId}));
      return isTransportCurrent(owner);
    } catch (err) {
      setError(errMsg(err));
      return false;
    }
  }

  async function onToggle(task: Task) {
    if (!safeAction()) return;
    try {
      await mutate(() => task.completed ? uncompleteTask(task.id) : completeTask(task.id));
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function onDelete(task: Task) {
    if (!safeAction()) return;
    try {
      await mutate(() => apiDeleteTask(task.id), task.id);
    } catch (err) {
      setError(errMsg(err));
    }
  }

  function onEdit(task: Task) {
    if (!safeAction()) return;
    setEditSuspended(false);
    editOwner.current = captureTransport();
    editExpected.current = task;
    setEditTask(task);
  }

  // Remove a list from the whole store: strip its token from every task that carries
  // it. Use the full accepted list (not the filtered view) so removal spans completed tasks too;
  // update each affected task sequentially (the file-backed, one-writer model), retaining each
  // successful response. loadLabels drops the unused name and clears a filter that selected it.
  async function confirmRemove() {
    if (!removing || bulkOwner.current) return;
    const owner = captureTransport();
    if (!isTransportCurrent(promptContext.current)) { setListNotice("The connection changed. Close and reopen the selector before confirming."); return; }
    let record = displayedRecord.current;
    if (!record) record = createRecord("remove", removing.name, "", owner);
    if (record.kind !== "remove" || record.operation.targetDestination !== destination(owner)) return;
    setListNotice("");
    setRemoveOperation(record.operation);
    startBulk(owner);
    try { await record.operation.run(owner); }
    finally { finishBulk(owner); }
  }

  function ensureListContext(owner: TransportContext) {
    if (!mounted.current || !isTransportCurrent(owner)) throw new Error("The connection changed. No further list writes were issued.");
  }
  function startBulk(owner: TransportContext) {
    bulkOwner.current = owner;
    tasksRequest.current++; labelsRequest.current++; recovery.current?.cancel();
  }
  function finishBulk(owner: TransportContext) {
    if (bulkOwner.current === owner) bulkOwner.current = null;
    if (mounted.current && queuedRefresh.current) { queuedRefresh.current = false; requestTasks(); }
  }
  async function validateListTasks(owner: TransportContext): Promise<Task[]> {
    ensureListContext(owner);
    if (owner.url && updates) {
      const checked = await updates.check("tasks");
      ensureListContext(owner);
      if (!checked) throw new ListReviewRequired();
      return updates.accepted("tasks")!;
    }
    const found = await listTasks({}, owner);
    ensureListContext(owner);
    const equal = found.length === taskProjection.current.length && found.every((task) => taskProjection.current.some((known) => known.id === task.id && known.raw === task.raw));
    if (!equal) {
      queuedRefresh.current = true;
      throw new Error("Local tasks changed. The task view will refresh after this attempt stops; explicitly retry against the current tasks.");
    }
    return found;
  }
  function guardDraft(text: string) {
    const operation = records.current.get(destination(captureTransport()))?.operation;
    if (operation?.started && operation.phase !== "completed" && operation.targetDestination === destination(captureTransport())
      && text.split(/\s+/).includes(`+${operation.from}`)) throw new Error("This draft refers to an unfinished list operation. Finish it or explicitly stop retry before saving it.");
  }
  function openRecord(record: ListRecord, origin: ListOrigin, session?: ListSelectorSession) {
    promptSession.current = session;
    displayedRecord.current = record;
    promptOrigin.current = origin; promptContext.current = captureTransport();
    if (record.kind === "rename") {
      setRemoving(null); setRemoveOperation(null); setRenameOperation(record.operation); setRenameSource(record.operation.from);
    } else {
      setRenameSource(null); setRenameOperation(null); setRemoveOperation(record.operation); setRemoving({ kind: "list", name: record.operation.from });
    }
  }
  function recoverList(id: number, origin: ListOrigin, session?: ListSelectorSession) {
    if (bulkOwner.current) { session?.close(); setError("Wait for the current list attempt to settle."); return; }
    const record = [...records.current.values()].find((found) => found.id === id);
    if (record) { setListNotice(""); openRecord(record, origin, session); }
  }
  function listAction(request: ListActionRequest): boolean {
    function reject(message: string) { request.session?.close(); setError(message); return true; }
    if (!canMutate("tasks") || !isTransportCurrent(projectionOwner.current)) return reject("Destination is still loading. Reopen the selector when ready.");
    if (request.destination !== destination(captureTransport())) return reject("The destination changed. Reopen the selector.");
    if (bulkOwner.current) return reject("Wait for the current list attempt to settle.");
    const existing = records.current.get(request.destination);
    const pending = existing && existing.operation.started && existing.operation.phase !== "completed" ? existing : undefined;
    if (pending) {
      const related = pending.operation.from === request.name || (pending.kind === "rename" && pending.operation.to === request.name);
      if (related || request.scope === "known" || request.recoveryId !== undefined) {
        setListNotice(related && pending.kind === request.action ? "" : "Finish or explicitly stop this pending operation before starting another list action.");
        openRecord(pending, request.origin, request.session); return true;
      }
    }
    if (request.recoveryId !== undefined) return reject("That operation result changed. Reopen the selector.");
    if (request.scope === "staged") return false;
    if (!knownLabels.current.list.includes(request.name)) return reject("That list changed. Reopen the selector for a new confirmation.");
    displayedRecord.current = null;
    promptSession.current = request.session;
    promptContext.current = captureTransport(); promptOrigin.current = request.origin;
    setListNotice(""); setRenameOperation(null); setRemoveOperation(null);
    if (request.action === "rename") { setRemoving(null); setRenameSource(request.name); }
    else { setRenameSource(null); setRemoving({ kind: "list", name: request.name }); }
    return true;
  }
  function createRecord(kind: "rename" | "remove", from: string, to: string, owner: TransportContext): ListRecord {
    let record: ListRecord;
    const ports = {
      ...listRenameIO, validate: validateListTasks,
      write: async (id: number, text: string, context: TransportContext) => {
        const task = await mutate(() => updateTask(id, text, context), undefined, context, false);
        if (!task) throw new Error("The task write returned no task. Revalidate before retrying.");
        return task;
      },
      staged: () => [...draftLists.current.add, ...draftLists.current.edit],
      current: () => mounted.current && records.current.get(record.operation.targetDestination) === record,
      changed: () => { if (mounted.current) redraw((n) => n + 1); },
      completed: (labels: Labels) => completeList(record, labels),
    };
    record = kind === "rename" ? { id: ++renameSequence.current, kind, operation: new ListRename(from, to, owner, ports) }
      : { id: ++renameSequence.current, kind, operation: new ListRemoval(from, owner, ports) };
    records.current.set(destination(owner), record); displayedRecord.current = record;
    return record;
  }
  function completeList(record: ListRecord, labels: Labels) {
    ensureListContext(captureTransport());
    const operation = record.operation;
    if (destination(captureTransport()) !== operation.targetDestination) return;
    const known = remote()?.accepted("tasks") ?? taskProjection.current;
    setServerLabels({ list: unionLabels(labels.list, known.flatMap((task) => task.lists)), context: unionLabels(labels.context, known.flatMap((task) => task.contexts)) });
    const transform = (text: string) => record.kind === "rename" ? renameListText(text, operation.from, record.operation.to) : removeListText(text, operation.from);
    const updated = operation.done.get(editExpected.current?.id ?? -1);
    if (updated && editExpected.current && destination(editOwner.current) === operation.targetDestination && transform(editExpected.current.raw) === updated.raw) editExpected.current = updated;
    const event = { id: ++renameSequence.current, destination: operation.targetDestination, from: operation.from, tasks: [...operation.done.values()] };
    if (record.kind === "rename") {
      setList((selected) => selected === operation.from ? record.operation.to : selected);
      setRenameEvent({ ...event, to: record.operation.to });
    } else {
      setList((selected) => selected === operation.from ? "" : selected);
      setRemovalEvent(event);
    }
    setListNotice(""); setError("");
  }
  async function confirmRename(name: string) {
    if (renameSource === null || bulkOwner.current) return;
    const parsed = parseLabelInput(name);
    if ("error" in parsed) return;
    const owner = captureTransport();
    if (!isTransportCurrent(promptContext.current)) { setListNotice("The connection changed. Close and reopen the selector before confirming."); return; }
    let record = displayedRecord.current;
    if (!record || !record.operation.started) record = createRecord("rename", renameSource, parsed.name, owner);
    if (record.kind !== "rename" || record.operation.targetDestination !== destination(owner)) return;
    setListNotice("");
    setRenameOperation(record.operation);
    startBulk(owner);
    try { await record.operation.run(owner); }
    finally { finishBulk(owner); }
    if (mounted.current && isTransportCurrent(owner) && displayedRecord.current === record && record.operation.phase === "completed") {
      closeRename(record.operation.to, record.operation.from === record.operation.to ? undefined : renameSequence.current);
    }
  }
  function closeRename(focusName?: string, revision?: number) {
    if (displayedRecord.current?.operation.busy) return;
    setRenameSource(null); setRemoving(null);
    const record = displayedRecord.current;
    if (record && (!record.operation.started || record.operation.phase === "completed")) records.current.delete(record.operation.targetDestination);
    if (promptSession.current) {
      promptSession.current.restore(focusName ?? record?.operation.from ?? renameSource ?? removing?.name ?? "", revision);
      promptSession.current = undefined;
      return;
    }
    const selector = promptOrigin.current === "add" ? (compact ? '#add-form button[aria-label="Task options"]' : '#add-form button[aria-label="List"]')
      : (compact ? 'button[aria-label="Filter options"]' : 'button[aria-label="List filter"]');
    document.querySelector<HTMLButtonElement>(selector)?.focus();
  }
  function reviewRename() {
    if (bulkOwner.current) return;
    promptSession.current?.close(); promptSession.current = undefined;
    setRenameSource(null); setEditSuspended(true); setRemoving(null);
    void remote()?.review("tasks");
  }
  function abandonRename() {
    if (bulkOwner.current) return;
    const record = displayedRecord.current;
    if (record) records.current.delete(record.operation.targetDestination);
    closeRename(); displayedRecord.current = null; setRenameOperation(null); setRemoveOperation(null);
    setError("List retry stopped. Partial task and label changes remain; no changes were rolled back.");
  }

  async function onEditSave(id: number, text: string, routing?: TaskRouting) {
    const owner = captureTransport();
    if (destination(editOwner.current) !== destination(captureTransport())) {
      throw new Error("The destination changed. Copy your draft and choose Edit on the current destination.");
    }
    if (!safeAction()) throw new Error("Review the task update first. Your draft is unchanged.");
    guardDraft(text);
    if (!(remote()?.accepted("tasks") ?? taskProjection.current).some((task) => task.id === id && task.raw === editExpected.current?.raw)) {
      throw new Error("This task changed. Copy your draft and choose Edit on the updated task; the old action cannot be replayed.");
    }
    try { await mutate(() => updateTask(id, text, owner, routing)); }
    catch (error) { requestTasks(); throw error; } // Refresh exposes durable move recovery without replay.
    if (!isTransportCurrent(owner)) throw new Error("The destination changed while saving. Your draft is unchanged; revalidate before retrying.");
    setEditTask(null);
  }

  const sorted = sortTasks(tasks.filter((task) => !list || task.lists.includes(list)), sort, dir);
  const pending: ListRecovery[] = [...records.current.values()].filter((record) => record.operation.started && record.operation.phase !== "completed").map((record) => ({
    id: record.id, kind: record.kind, from: record.operation.from, to: record.kind === "rename" ? record.operation.to : undefined,
    destination: record.operation.targetDestination, summary: `Unfinished ${record.kind === "rename" ? "rename" : "removal"}: ${record.operation.done.size} tasks updated. Open its action to finish or stop retry.`,
  }));
  const management: ListManagement = { destination: destination(captureTransport()), pending, onAction: listAction, onRecover: recoverList };

  return (
    <HaLists catalog={haCatalog} setCatalog={setHaCatalog} disabled={disabled || catalogBlocked || !isTransportCurrent(catalogOwner.current)} beforeMutation={safeAction} onChanged={requestTasks} onDialogChange={setHaDialog}>
    <section className="pane todo-pane" id="todo-view">
      <div className={compact ? "todo-header todo-header--compact" : "todo-header"}>
        <h1>todo</h1>

        <FilterBar
          disabled={disabled}
          list={list}
          sort={sort}
          dir={dir}
          compact={compact}
          serverLabels={serverLabels}
          onList={setList}
          onSort={(s) => { setSort(s); persistSort(s); }}
          onDir={(d) => { const next = d as Direction; setDir(next); persistDir(next); }}
          onRemove={(kind, name) => setRemoving({ kind, name })}
          management={management}
        />
      </div>
      
      <div className="task-list">
        <fieldset className="destination-controls" disabled={disabled}>
          <ul id="tasks">
            {sorted.map((task) => (
              <TaskItem key={task.id} task={task} onToggle={onToggle} onEdit={onEdit} onDelete={onDelete} />
            ))}
          </ul>
          <p id="empty" hidden={sorted.length !== 0}>
            No tasks.
          </p>
          <p id="error" role="alert" hidden={!error}>
            {error}
          </p>
        </fieldset>
      </div>

      <AddForm serverLabels={serverLabels} onAdd={onAdd} compact={compact} rename={renameEvent} removal={removalEvent} onListsChange={addLists} management={management} disabled={disabled || catalogBlocked} />
      {editTask && editSuspended && <button type="button" onClick={() => setEditSuspended(false)}>Resume task draft</button>}

      <EditTaskModal
        disabled={disabled}
        task={editTask}
        suspended={editSuspended}
        serverLabels={serverLabels}
        onSave={onEditSave}
        onClose={() => setEditTask(null)}
        rename={renameEvent}
        removal={removalEvent}
        onListsChange={editLists}
      />

      <RemoveLabelDialog target={removing} operation={removeOperation} error={listNotice} onConfirm={() => { void confirmRemove(); }} onCancel={closeRename}
        onReview={reviewRename} onAbandon={abandonRename} readOnly={disabled || (!!removeOperation && removeOperation.targetDestination !== management.destination)} />
      <RenameListDialog source={renameSource} operation={renameOperation}
        onConfirm={(name) => { void confirmRename(name); }} onClose={closeRename} onReview={reviewRename} onAbandon={abandonRename} error={listNotice}
        readOnly={disabled || (!!renameOperation && renameOperation.targetDestination !== management.destination)} />
    </section>
    </HaLists>
  );
});

TodoPane.displayName = "TodoPane";
export default TodoPane;
