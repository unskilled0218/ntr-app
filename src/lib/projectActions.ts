export type ProjectAction = "rename" | "remove";
export type ProjectOrigin = "add" | "filter";
export interface ProjectRecovery {
  id: number;
  kind: ProjectAction;
  from: string;
  to?: string;
  destination: string;
  summary: string;
}
export interface ProjectSelectorSession {
  // False means the session is obsolete; enclosing dialogs must not be closed either.
  close(): boolean;
  restore(name: string, revision?: number): void;
}
export interface ProjectActionRequest { action: ProjectAction; name: string; scope: "known" | "staged"; destination: string; origin: ProjectOrigin; recoveryId?: number; session?: ProjectSelectorSession }
export interface ProjectManagement {
  destination: string;
  pending: ProjectRecovery[];
  // True means the global owner handled recovery, blocked work, or opened confirmation.
  onAction(request: ProjectActionRequest): boolean;
  onRecover(id: number, origin: ProjectOrigin, session?: ProjectSelectorSession): void;
}
export function relatedRecovery(name: string, management: ProjectManagement) {
  return management.pending.find((record) => record.destination === management.destination && (record.from === name || record.to === name));
}
export function recoveryEntries(names: string[], management?: ProjectManagement) {
  return management?.pending.filter((record) => record.destination !== management.destination || !names.some((name) => name === record.from || name === record.to)).map((record) => ({
    id: record.id, kind: record.kind,
    label: `Resume unfinished ${record.kind === "rename" ? "rename" : "removal"}: ${record.from}${record.to ? ` → ${record.to}` : ""}${record.destination !== management.destination ? ` (${record.destination})` : ""}`,
  })) ?? [];
}
