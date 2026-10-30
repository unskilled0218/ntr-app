import { destination, errMsg, isTransportCurrent, type Labels, type Task, type TransportContext } from "../api";
import { equalLabels, removeProjectText } from "../labels";
import { ProjectReviewRequired, type ProjectRenamePorts, type RenamePhase } from "./projectRename";

export interface ProjectRemovalEvent { id: number; destination: string; from: string; tasks: Task[] }
export type ProjectRemovalPorts = Omit<ProjectRenamePorts, "staged">;

// Removal owns its own progress, not a rename with an empty target. All retries are explicit.
export class ProjectRemoval {
  phase: RenamePhase = "ready";
  error = "";
  started = false;
  remaining = 0;
  readonly done = new Map<number, Task>();
  readonly targetDestination: string;
  private uncertain?: { id: number; before: string; intended: string };
  private labelAttempt?: { before: Labels; intended: Labels };
  constructor(readonly from: string, context: TransportContext, private readonly ports: ProjectRemovalPorts) {
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
      if (!this.started && !tasks.some((task) => task.projects.includes(this.from)) && !initialLabels.project.includes(this.from)) {
        throw new Error("The source project no longer exists. Reopen the selector and choose a current project.");
      }
      const plan = tasks.filter((task) => task.projects.includes(this.from)).map((task) => ({ id: task.id, before: task.raw, intended: removeProjectText(task.raw, this.from) }));
      this.remaining = plan.length; this.phase = "running"; this.ports.changed();
      for (const change of plan) {
        tasks = await this.ports.validate(context); this.ensure(context);
        if (tasks.find((task) => task.id === change.id)?.raw !== change.before) throw new ProjectReviewRequired();
        this.started = true; this.uncertain = change;
        const task = await this.ports.write(change.id, change.intended, context);
        this.done.set(task.id, task); this.uncertain = undefined; this.remaining--;
        this.ensure(context); this.ports.changed();
        await this.ports.validate(context); this.ensure(context);
      }
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      tasksDone = true;
      let labels = await this.ports.labels(context); this.ensure(context);
      if (this.labelAttempt && !equalLabels(labels, this.labelAttempt.before) && !equalLabels(labels, this.labelAttempt.intended)) {
        throw new Error("Remembered projects changed after an uncertain removal. Resolve labels or explicitly stop retry; completed changes remain.");
      }
      const intended = { ...labels, project: labels.project.filter((name) => name !== this.from) };
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      if (!this.labelAttempt || !equalLabels(labels, this.labelAttempt.intended)) {
        this.labelAttempt = { before: labels, intended }; this.started = true;
        await this.ports.saveLabels(intended, context); this.ensure(context);
        labels = await this.ports.labels(context); this.ensure(context);
        if (!equalLabels(labels, intended)) throw new Error("Could not verify project removal from remembered labels. Tasks already changed remain changed.");
      }
      tasks = await this.ports.validate(context); this.ensure(context);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      this.phase = "completed"; this.ports.completed(labels);
    } catch (error) {
      this.phase = error instanceof ProjectReviewRequired ? "paused-for-review" : tasksDone ? "labels-pending" : "failed";
      this.error = errMsg(error);
    } finally { this.ports.changed(); }
    return this.phase === "completed" ? "completed" : this.started ? "partial" : "failed";
  }
}
