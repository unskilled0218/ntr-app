// What reconciling the editor with the backend means, given the last-saved base, the editor's
// current text, and the freshly-fetched remote text. Pure (three strings in, one verdict out),
// ported from web/app.js classifyNoteEvent, so the meaning has a single, testable home.
//
//   "noop"     — the server has not changed from our base; nothing to do (keep editing).
//   "adopt"    — the server changed and there are no unsaved local edits; take the remote.
//   "in-sync"  — the server changed but the editor already holds that text; just rebase the base.
//   "conflict" — the server changed AND unsaved local edits differ from it; the user must choose.
export type NoteVerdict = "noop" | "adopt" | "in-sync" | "conflict";

export function classifyNoteEvent(saved: string, local: string, remote: string): NoteVerdict {
  if (remote === saved) return "noop";
  if (local === saved) return "adopt";
  if (local === remote) return "in-sync";
  return "conflict";
}
