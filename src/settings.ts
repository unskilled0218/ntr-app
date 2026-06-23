const KEY = "ntr.serverUrl";

export function getServerUrl(): string {
  return localStorage.getItem(KEY) ?? "";
}

export function setServerUrl(url: string): void {
  url ? localStorage.setItem(KEY, url) : localStorage.removeItem(KEY);
}
