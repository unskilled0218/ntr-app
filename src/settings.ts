const KEY = "ntr.serverUrl";
const STRATEGY_KEY = "ntr.conflictStrategy";

export function getServerUrl(): string {
  return localStorage.getItem(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY);
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
