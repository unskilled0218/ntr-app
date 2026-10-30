import { destination, errMsg, getLabels, isTransportCurrent, putLabels, updateTask, type Labels, type Task, type TransportContext } from "../api";
import { equalLabels as sameLabels, planProjectRename, renameProjectNames } from "../labels";

export type RenamePhase = "ready" | "checking" | "running" | "paused-for-review" | "failed" | "labels-pending" | "completed";
export interface ProjectRenameEvent {
  id: number;
  destination: string;
  from: string;
  to: string;
  tasks: Task[];
}
export class ProjectReviewRequired extends Error {
  constructor() { super("Tasks changed. Review the update, then explicitly retry the rename."); }
}
export interface ProjectRenamePorts {
  validate(context: TransportContext): Promise<Task[]>;
  write(id: number, text: string, context: TransportContext): Promise<Task>;
  labels(context: TransportContext): Promise<Labels>;
  saveLabels(labels: Labels, context: TransportContext): Promise<void>;
  staged(): string[];
  current(): boolean;
  changed(): void;
  completed(labels: Labels): void;
}
export const projectRenameIO = { write: updateTask, labels: getLabels, saveLabels: putLabels };

// One operation owns provenance; each explicit run gets fresh, scoped write authority.
// No React/DOM dependency and no retry, rollback, or remote approval hidden in this helper.
export class ProjectRename {
  phase: RenamePhase = "ready";
  error = "";
  started = false;
  remaining = 0;
  readonly done = new Map<number, Task>();
  private uncertain?: { id: number; text: string };
  private labelAttempt?: { before: Labels; intended: Labels };
  private attempt = 0;
  readonly targetDestination: string;
  constructor(readonly from: string, readonly to: string, context: TransportContext, private readonly ports: ProjectRenamePorts) {
    this.targetDestination = destination(context);
  }
  get busy() { return this.phase === "checking" || this.phase === "running"; }
  private ensure(context: TransportContext, attempt: number) {
    if (!this.ports.current() || !isTransportCurrent(context) || destination(context) !== this.targetDestination || this.attempt !== attempt) {
      throw new Error("The connection changed. No further rename writes were issued. Return to the original destination and revalidate before retrying.");
    }
  }
  private collision(tasks: Task[], labels: Labels) {
    if (this.uncertain) {
      // A user-confirmed retry after approval can resolve an uncertain task by observed content.
      const observed = tasks.find((task) => task.id === this.uncertain!.id && task.raw === this.uncertain!.text);
      if (observed) this.done.set(observed.id, observed);
      else if (tasks.some((task) => task.id === this.uncertain!.id && task.projects.includes(this.to))) {
        throw new Error("The uncertain task has an unexplained target reference. Resolve it before retrying.");
      }
      this.uncertain = undefined;
    }
    for (const [id, known] of this.done) {
      if (tasks.find((task) => task.id === id)?.raw !== known.raw) throw new Error("A renamed task changed again. Resolve that task before continuing this rename.");
    }
    if (tasks.some((task) => task.projects.includes(this.to) && this.done.get(task.id)?.raw !== task.raw)
      || this.ports.staged().includes(this.to)) throw new Error("That project already exists. Renaming cannot merge projects.");
    if (labels.project.includes(this.to) && !this.labelAttempt) throw new Error("That project already exists in remembered projects.");
  }
  async run(context: TransportContext) {
    if (this.busy || this.phase === "completed") return;
    if (this.from === this.to) { this.phase = "completed"; this.ports.changed(); return; }
    const attempt = ++this.attempt;
    this.phase = "checking"; this.error = ""; this.ports.changed();
    let tasksDone = false;
    try {
      this.ensure(context, attempt);
      let tasks = await this.ports.validate(context);
      this.ensure(context, attempt);
      let labels = await this.ports.labels(context);
      this.ensure(context, attempt);
      this.collision(tasks, labels);
      if (!this.started && !tasks.some((task) => task.projects.includes(this.from)) && !labels.project.includes(this.from)) {
        throw new Error("The source project no longer exists. Close this result and choose a current project.");
      }
      const plan = planProjectRename(tasks, this.from, this.to);
      this.remaining = plan.length;
      this.phase = "running"; this.ports.changed();
      for (const change of plan) {
        tasks = await this.ports.validate(context);
        this.ensure(context, attempt);
        if (tasks.find((task) => task.id === change.id)?.raw !== change.expected) throw new ProjectReviewRequired();
        this.collision(tasks, labels);
        this.started = true;
        this.uncertain = { id: change.id, text: change.text };
        const task = await this.ports.write(change.id, change.text, context);
        // Retain original-destination evidence even if a connection change prevents projection.
        this.done.set(task.id, task); this.uncertain = undefined; this.remaining--;
        this.ensure(context, attempt);
        this.ports.changed();
        await this.ports.validate(context);
        this.ensure(context, attempt);
      }
      tasks = await this.ports.validate(context);
      this.ensure(context, attempt);
      tasksDone = true;
      labels = await this.ports.labels(context);
      this.ensure(context, attempt);
      this.collision(tasks, labels);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      if (this.labelAttempt) {
        if (!sameLabels(labels, this.labelAttempt.intended) && !sameLabels(labels, this.labelAttempt.before)) {
          throw new Error("Remembered projects changed after the label write. Resolve the labels before retrying; completed tasks remain renamed.");
        }
      }
      const intended = { ...labels, project: renameProjectNames(labels.project, this.from, this.to) };
      if (!intended.project.includes(this.to)) intended.project.push(this.to);
      tasks = await this.ports.validate(context);
      this.ensure(context, attempt);
      this.collision(tasks, labels);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      if (!this.labelAttempt || !sameLabels(labels, this.labelAttempt.intended)) {
        this.ensure(context, attempt);
        this.labelAttempt = { before: labels, intended };
        this.started = true;
        await this.ports.saveLabels(intended, context);
        this.ensure(context, attempt);
        labels = await this.ports.labels(context);
        this.ensure(context, attempt);
        if (!sameLabels(labels, intended)) throw new Error("Could not verify remembered projects. Completed tasks remain renamed; check labels and retry.");
      }
      tasks = await this.ports.validate(context);
      this.ensure(context, attempt);
      this.collision(tasks, labels);
      if (tasks.some((task) => task.projects.includes(this.from))) throw new ProjectReviewRequired();
      this.phase = "completed";
      this.ports.completed(labels);
    } catch (error) {
      this.phase = error instanceof ProjectReviewRequired ? "paused-for-review" : tasksDone ? "labels-pending" : "failed";
      this.error = errMsg(error);
    } finally { this.ports.changed(); }
  }
}
