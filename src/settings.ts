import { DIRECTIONS, SORTS, STATUSES, type Direction, type Status } from "./config";

const KEY = "ntr.serverUrl";
const STRATEGY_KEY = "ntr.conflictStrategy";
const ALLOW_INVALID_CERT_KEY = "ntr.allowInvalidCert";
const COMPACT_UI_KEY = "ntr.compactUi";
const STATUS_KEY = "ntr.status";
const SORT_KEY = "ntr.sort";
const SORT_DIR_KEY = "ntr.sortDir";

export function getServerUrl(): string {
  return localStorage.getItem(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY);
}

// Whether server-mode HTTP accepts a self-signed / untrusted TLS certificate. Off by default
// (absent key), opt-in for a local HTTPS server behind a reverse proxy (e.g. https://ntr.lan).
// Disabling TLS validation is a real downgrade, so it is represented like setServerUrl: the
// "1" value only exists when the user has explicitly turned it on.
export function getAllowInvalidCert(): boolean {
  return localStorage.getItem(ALLOW_INVALID_CERT_KEY) === "1";
}

export function setAllowInvalidCert(allow: boolean): void {
  allow
    ? localStorage.setItem(ALLOW_INVALID_CERT_KEY, "1")
    : localStorage.removeItem(ALLOW_INVALID_CERT_KEY);
}

// Whether the todo controls render in the compact, modal-collapsed layout. Off by default
// (absent key); persisted like setAllowInvalidCert — "1" only when explicitly enabled.
export function getCompactUi(): boolean {
  return localStorage.getItem(COMPACT_UI_KEY) === "1";
}

export function setCompactUi(on: boolean): void {
  on ? localStorage.setItem(COMPACT_UI_KEY, "1") : localStorage.removeItem(COMPACT_UI_KEY);
}

// How a server/local divergence is resolved on reconcile. "ask" prompts the user
// (the default); "server"/"local" auto-apply that side without a dialog.
export type ConflictStrategy = "ask" | "server" | "local";

export function getConflictStrategy(): ConflictStrategy {
  const v = localStorage.getItem(STRATEGY_KEY);
  return v === "server" || v === "local" ? v : "ask";
}

export function setConflictStrategy(s: ConflictStrategy): void {
  // "ask" is the default; represent it by the absence of the key, as setServerUrl does.
  s === "ask" ? localStorage.removeItem(STRATEGY_KEY) : localStorage.setItem(STRATEGY_KEY, s);
}

// The todo view options — status filter, sort key, sort direction — persisted to the local cache
// only (never sent to the server): they describe how THIS client views the list, not the tasks
// themselves. Each is validated against its config table on read, so a stored value that no longer
// exists (e.g. a sort key dropped in a later version, as `alpha` was in task 16) degrades to the
// default instead of throwing in sortTasks. The default is the absence of the key, exactly as
// setServerUrl / setConflictStrategy represent theirs.

export function getStatus(): Status {
  const v = localStorage.getItem(STATUS_KEY);
  return v && v in STATUSES ? (v as Status) : "all";
}

export function setStatus(s: Status): void {
  s === "all" ? localStorage.removeItem(STATUS_KEY) : localStorage.setItem(STATUS_KEY, s);
}

export function getSort(): string {
  const v = localStorage.getItem(SORT_KEY);
  return v && v in SORTS ? v : "file";
}

export function setSort(s: string): void {
  s === "file" ? localStorage.removeItem(SORT_KEY) : localStorage.setItem(SORT_KEY, s);
}

export function getDirection(): Direction {
  const v = localStorage.getItem(SORT_DIR_KEY);
  return v && v in DIRECTIONS ? (v as Direction) : "asc";
}

export function setDirection(d: Direction): void {
  d === "asc" ? localStorage.removeItem(SORT_DIR_KEY) : localStorage.setItem(SORT_DIR_KEY, d);
}
