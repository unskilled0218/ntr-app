import { destination, errMsg, isTransportCurrent, type Labels, type Task, type TransportContext } from "../api";
import { equalLabels, removeListText } from "../labels";
import { ListReviewRequired, type ListRenamePorts, type RenamePhase } from "./listRename";

export interface ListRemovalEvent { id: number; destination: string; from: string; tasks: Task[] }
export type ListRemovalPorts = Omit<ListRenamePorts, "staged">;

// Removal owns its own progress, not a rename with an empty target. All retries are explicit.
export class ListRemoval {
  phase: RenamePhase = "ready";
  error = "";
  started = false;
  remaining = 0;
  readonly done = new Map<number, Task>();
  readonly targetDestination: string;
  private uncertain?: { id: number; before: string; intended: string };
  private labelAttempt?: { before: Labels; intended: Labels };
  constructor(readonly from: string, context: TransportContext, private readonly ports: ListRemovalPorts) {
    this.targetDestination = destination(context);
  }
  get busy() { return this.phase === "checking" || this.phase === "running"; }
  private ensure(context: TransportContext) {
    if (!this.ports.current() || !isTransportCurrent(context) || destination(context) !== this.targetDestination) {
      throw new Error("The connection changed. Return to the original destination and explicitly retry; completed changes remain.");
    }
  }
  async run(context: TransportContext) {
    if (this.busy || this.phase === "completed") return;
    this.phase = "checking"; this.error = ""; this.ports.changed();
    let tasksDone = false;
    try {
      this.ensure(context);
      let tasks = await this.ports.validate(context); this.ensure(context);
      if (this.uncertain) {
        const found = tasks.find((task) => task.id === this.uncertain!.id);
        if (found?.raw === this.uncertain.intended) this.done.set(found.id, found);
        else if (found && found.raw !== this.uncertain.before) throw new Error("The uncertain task changed. Resolve its current content before retrying removal.");
        this.uncertain = undefined;
      }
      const initialLabels = await this.ports.labels(context); this.ensure(context);
      if (!this.started && !tasks.some((task) => task.lists.includes(this.from)) && !initialLabels.list.includes(this.from)) {
        throw new Error("The source list no longer exists. Reopen the selector and choose a current list.");
      }
      const plan = tasks.filter((task) => task.lists.includes(this.from)).map((task) => ({ id: task.id, before: task.raw, intended: removeListText(task.raw, this.from) }));
      this.remaining = plan.length; this.phase = "running"; this.ports.changed();
      for (const change of plan) {
        tasks = await this.ports.validate(context); this.ensure(context);
        if (tasks.find((task) => task.id === change.id)?.raw !== change.before) throw new ListReviewRequired();
        this.started = true; this.uncertain = change;
        const task = await this.ports.write(change.id, change.intended, context);
        this.done.set(task.id, task); this.uncertain = undefined; this.remaining--;
        this.ensure(context); this.ports.changed();
        await this.ports.validate(context); this.ensure(context);
      }
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.lists.includes(this.from))) throw new ListReviewRequired();
      tasksDone = true;
      let labels = await this.ports.labels(context); this.ensure(context);
      if (this.labelAttempt && !equalLabels(labels, this.labelAttempt.before) && !equalLabels(labels, this.labelAttempt.intended)) {
        throw new Error("Remembered lists changed after an uncertain removal. Resolve labels or explicitly stop retry; completed changes remain.");
      }
      const intended = { ...labels, list: labels.list.filter((name) => name !== this.from) };
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.lists.includes(this.from))) throw new ListReviewRequired();
      if (!this.labelAttempt || !equalLabels(labels, this.labelAttempt.intended)) {
        this.labelAttempt = { before: labels, intended }; this.started = true;
        await this.ports.saveLabels(intended, context); this.ensure(context);
        labels = await this.ports.labels(context); this.ensure(context);
        if (!equalLabels(labels, intended)) throw new Error("Could not verify list removal from remembered labels. Tasks already changed remain changed.");
      }
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.lists.includes(this.from))) throw new ListReviewRequired();
      this.phase = "completed"; this.ports.completed(labels);
    } catch (error) {
      this.phase = error instanceof ListReviewRequired ? "paused-for-review" : tasksDone ? "labels-pending" : "failed";
      this.error = errMsg(error);
    } finally { this.ports.changed(); }
    return this.phase === "completed" ? "completed" : this.started ? "partial" : "failed";
  }
}
