import type { Labels, Task } from "../api";

// Legacy protocol/storage names stay here, never in task-grouping domain code.
export type TaskWire = Omit<Task, "lists"> & { projects: string[] };
export type LabelsWire = { project: string[]; context: string[] };

export function taskFromWire(value: TaskWire | Task): Task {
  if ("projects" in value) {
    const { projects, ...task } = value;
    return { ...task, lists: projects };
  }
  return value;
}

export function labelsFromWire(value: LabelsWire | Labels): Labels {
  if ("project" in value) {
    const { project, ...labels } = value;
    return { ...labels, list: project };
  }
  return value;
}

export function labelsToWire(value: Labels): LabelsWire {
  return { project: value.list, context: value.context };
}
