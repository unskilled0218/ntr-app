import { openUrl } from "@tauri-apps/plugin-opener";

// Open a note link in the OS browser via the Tauri opener plugin (already a dependency and a granted
// capability — see src-tauri/capabilities/default.json "opener:default"). Restricted to http(s)/mailto so
// a crafted note can never hand the system handler an arbitrary scheme (file:, javascript:, …); anything
// else is ignored. Failures (e.g. no Tauri runtime under tests) are swallowed: opening a link must never
// throw into the editor.
export function openLink(url: string): void {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  openUrl(url).catch(() => {});
}
