// Reconciling one resource's local copy with the server's, with no stored base
// to compare against. Pure (two strings in, one verdict out), mirroring
// lib/noteSync.ts so the meaning has a single, testable home.
//
//   "in-sync"      — the two copies are identical; nothing to do.
//   "adopt-server" — they differ but the local copy is empty, so there is no
//                    local work to lose; take the server copy silently.
//   "conflict"     — they differ and the local copy is non-empty; the user
//                    (or the configured strategy) must choose a winner.
export type ConflictVerdict = "in-sync" | "adopt-server" | "conflict";

export function classifyConflict(local: string, server: string): ConflictVerdict {
  if (local === server) return "in-sync";
  if (local === "") return "adopt-server";
  return "conflict";
}
