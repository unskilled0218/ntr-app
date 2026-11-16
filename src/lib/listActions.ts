export type ListAction = "rename" | "remove";
export type ListOrigin = "add" | "filter";
export interface ListRecovery {
  id: number;
  kind: ListAction;
  from: string;
  to?: string;
  destination: string;
  summary: string;
}
export interface ListSelectorSession {
  // False means the session is obsolete; enclosing dialogs must not be closed either.
  close(): boolean;
  restore(name: string, revision?: number): void;
}
export interface ListActionRequest { action: ListAction; name: string; scope: "known" | "staged"; destination: string; origin: ListOrigin; recoveryId?: number; session?: ListSelectorSession }
export interface ListManagement {
  destination: string;
  pending: ListRecovery[];
  // True means the global owner handled recovery, blocked work, or opened confirmation.
  onAction(request: ListActionRequest): boolean;
  onRecover(id: number, origin: ListOrigin, session?: ListSelectorSession): void;
}
export function relatedRecovery(name: string, management: ListManagement) {
  return management.pending.find((record) => record.destination === management.destination && (record.from === name || record.to === name));
}
export function recoveryEntries(names: string[], management?: ListManagement) {
  return management?.pending.filter((record) => record.destination !== management.destination || !names.some((name) => name === record.from || name === record.to)).map((record) => ({
    id: record.id, kind: record.kind,
    label: `Resume unfinished ${record.kind === "rename" ? "rename" : "removal"}: ${record.from}${record.to ? ` → ${record.to}` : ""}${record.destination !== management.destination ? ` (${record.destination})` : ""}`,
  })) ?? [];
}
