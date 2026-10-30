import { captureTransport, destination, errMsg, getNote, isTransportCurrent, listTasks, type Task, type TransportContext } from "../api";
import { ResourceRefresh } from "./resourceRefresh";

export interface Snapshots { note: string; tasks: Task[] }
export type Resource = keyof Snapshots;
export type Phase = "idle" | "offered" | "deferred" | "applying";
export interface Offer<K extends Resource = Resource> {
  resource: K;
  identity: string;
  snapshot: Snapshots[K];
}
export interface ApplicationToken<K extends Resource = Resource> extends Offer<K> {
  offer: Offer<K>;
  destination: string;
  generation: number;
  epoch: number;
}
interface State<K extends Resource> {
  accepted?: Snapshots[K];
  pending?: Offer<K>;
  phase: Phase;
  epoch: number;
  reads: number;
  application: number;
  writes: number;
  error: string;
}
function identity<K extends Resource>(resource: K, snapshot: Snapshots[K]): string {
  if (resource === "note") return snapshot as string;
  // IDs are part of identity: replacing raw text can assign different IDs.
  return JSON.stringify((snapshot as Task[]).map((task) => [task.id, task.raw, task.completed, task.completion_date, task.creation_date]).sort((a, b) => Number(a[0]) - Number(b[0])));
}
function initial<K extends Resource>(): State<K> {
  return { phase: "idle", epoch: 0, reads: 0, application: 0, writes: 0, error: "" };
}

// Approval state lives here, never in a detection read or a pane's save baseline.
export class RemoteUpdates {
  private context = captureTransport();
  private active = true;
  private states = { note: initial<"note">(), tasks: initial<"tasks">() };
  private listeners = new Set<() => void>();
  private refresh: Record<Resource, ResourceRefresh>;

  constructor(private readonly read: <K extends Resource>(resource: K, context: TransportContext) => Promise<Snapshots[K]> =
    ((resource, context) => resource === "note" ? getNote(context) : listTasks({}, context)) as <K extends Resource>(resource: K, context: TransportContext) => Promise<Snapshots[K]>) {
    this.refresh = Object.fromEntries((["note", "tasks"] as const).map((resource) => [resource, new ResourceRefresh(
      async () => { await this.detect(resource); }, {
        canRun: () => isTransportCurrent(this.context) && this.states[resource].accepted !== undefined && this.states[resource].writes === 0,
        onError: (error) => { this.states[resource].error = `Could not check ${resource}: ${errMsg(error)}`; this.emit(); },
        onIdle: () => this.emit(),
      },
    )])) as Record<Resource, ResourceRefresh>;
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private emit() { this.listeners.forEach((listener) => listener()); }
  state<K extends Resource>(resource: K): Readonly<State<K>> { return this.states[resource] as State<K>; }
  accepted<K extends Resource>(resource: K): Snapshots[K] | undefined { return this.state(resource).accepted; }
  blocked(resource: Resource) { return !!this.states[resource].pending || this.refresh[resource].busy; }

  activate(context = captureTransport()) {
    const changed = destination(context) !== destination(this.context);
    this.cancel();
    this.active = true;
    this.context = context;
    if (changed) this.states = { note: initial<"note">(), tasks: initial<"tasks">() };
    else for (const resource of ["note", "tasks"] as const) {
      this.states[resource].epoch++;
      if (this.states[resource].phase === "applying") this.states[resource].phase = "offered";
      this.request(resource);
    }
    this.emit();
    return changed;
  }
  cancel() {
    this.active = false;
    for (const resource of ["note", "tasks"] as const) {
      this.refresh[resource].cancel();
      this.states[resource].epoch++;
      this.states[resource].reads++;
    }
  }
  resume() { this.active = true; }
  register<K extends Resource>(resource: K, snapshot: Snapshots[K]) {
    const state = this.states[resource] as State<K>;
    if (state.accepted !== undefined) return;
    state.accepted = snapshot;
    this.emit();
    // Also closes the event/initial-load race, even if the initial GET captured old content.
    this.request(resource);
  }
  initialize(resource: Resource) {
    this.refresh[resource].cancel();
    const state = this.states[resource];
    state.epoch++;
    state.reads++;
    state.accepted = undefined;
    state.pending = undefined;
    state.phase = "idle";
    state.error = "";
    this.emit();
  }
  request(resource: Resource) { if (this.active) this.refresh[resource].request(); }
  // Explicit operation validation waits for a fresh, epoch-valid read, not a busy flag.
  // Cancel only the runner's bookkeeping; read generations discard obsolete responses.
  async check(resource: Resource): Promise<boolean> {
    const state = this.states[resource];
    if (!this.active || state.accepted === undefined || state.writes) return false;
    this.refresh[resource].cancel();
    try {
      const checked = await this.detect(resource);
      return checked === true && !state.pending && !state.error && !state.writes;
    } catch (error) {
      this.fail(resource, error);
      throw error;
    } finally { this.emit(); }
  }
  private async detect<K extends Resource>(resource: K) {
    const state = this.states[resource] as State<K>;
    const context = this.context;
    const epoch = state.epoch;
    const read = ++state.reads;
    let snapshot: Snapshots[K];
    try { snapshot = await this.read(resource, context); }
    catch (error) {
      if (context !== this.context || !isTransportCurrent(context) || epoch !== state.epoch || read !== state.reads) return;
      throw error;
    }
    if (!isTransportCurrent(context) || context !== this.context || read !== state.reads || epoch !== state.epoch || state.writes) return;
    state.error = "";
    this.offer(resource, snapshot);
    return true;
  }
  offer<K extends Resource>(resource: K, snapshot: Snapshots[K]) {
    const state = this.states[resource] as State<K>;
    if (state.accepted === undefined) return;
    const key = identity(resource, snapshot);
    if (key === identity(resource, state.accepted)) {
      state.pending = undefined;
      state.phase = "idle";
    } else if (state.pending?.identity !== key) {
      state.pending = Object.freeze({ resource, identity: key, snapshot });
      state.phase = "offered";
    }
    this.emit();
  }
  begin<K extends Resource>(resource: K) {
    const state = this.states[resource] as State<K>;
    const context = this.context;
    state.epoch++;
    state.writes++;
    if (state.phase === "applying") state.phase = "offered";
    let settled = false;
    return (snapshot?: Snapshots[K]) => {
      if (settled) return;
      settled = true;
      state.writes--;
      state.epoch++;
      if (!this.active || destination(context) !== destination(this.context) || state !== this.states[resource]) return;
      if (snapshot !== undefined) state.accepted = snapshot;
      // A write is not convergence evidence for a different pending offer.
      this.request(resource);
      this.emit();
    };
  }
  defer(resource: Resource) {
    if (this.states[resource].pending) this.states[resource].phase = "deferred";
    this.emit();
  }
  async review(resource: Resource) {
    const context = this.context;
    const state = this.states[resource];
    try { if (!this.states[resource].writes) await this.detect(resource); }
    catch (error) { this.fail(resource, error); }
    if (context !== this.context || state !== this.states[resource] || !isTransportCurrent(context)) return;
    if (this.states[resource].pending) this.states[resource].phase = "offered";
    this.emit();
  }
  async prepare<K extends Resource>(offer: Offer<K>): Promise<ApplicationToken<K> | null> {
    const state = this.states[offer.resource] as State<K>;
    if (state.phase === "applying" || state.writes || state.pending !== offer) return null;
    const context = this.context;
    const epoch = state.epoch;
    const read = ++state.reads;
    const operation = ++state.application;
    let prepared = false;
    state.phase = "applying";
    this.emit();
    try {
      const snapshot = await this.read(offer.resource, context);
      if (!isTransportCurrent(context) || context !== this.context || read !== state.reads || epoch !== state.epoch || state.pending !== offer) return null;
      this.offer(offer.resource, snapshot);
      if (state.pending !== offer) return null;
      state.error = "";
      prepared = true;
      return Object.freeze({ ...offer, offer, destination: destination(context), generation: context.generation, epoch });
    } catch (error) {
      if (context === this.context && epoch === state.epoch && read === state.reads) state.error = `Could not load update: ${errMsg(error)}`;
      return null;
    } finally {
      if (!prepared && context === this.context && epoch === state.epoch && operation === state.application && state.phase === "applying") state.phase = "offered";
      this.emit();
    }
  }
  valid<K extends Resource>(token: ApplicationToken<K>) {
    const state = this.states[token.resource];
    return this.active && isTransportCurrent(this.context) && token.destination === destination(this.context)
      && token.generation === this.context.generation && token.epoch === state.epoch
      && !state.writes && state.pending === token.offer;
  }
  fail(resource: Resource, error: unknown) {
    this.states[resource].error = errMsg(error);
    if (this.states[resource].pending) this.states[resource].phase = "offered";
    this.emit();
  }
  commit<K extends Resource>(token: ApplicationToken<K>, apply: (snapshot: Snapshots[K]) => void): boolean {
    if (!this.valid(token)) return false;
    const state = this.states[token.resource] as State<K>;
    // No await between validating, painting, and advancing accepted state.
    try { apply(token.snapshot); }
    catch (error) { this.fail(token.resource, error); return false; }
    state.accepted = token.snapshot;
    state.pending = undefined;
    state.phase = "idle";
    state.error = "";
    this.emit();
    return true;
  }
}
