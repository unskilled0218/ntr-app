const KEY = "ntr.serverUrl";
const STRATEGY_KEY = "ntr.conflictStrategy";
const ALLOW_INVALID_CERT_KEY = "ntr.allowInvalidCert";
const COMPACT_UI_KEY = "ntr.compactUi";

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
