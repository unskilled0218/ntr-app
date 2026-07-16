import { NOTE_UNDO_COALESCE_MS, NOTE_UNDO_LIMIT } from "../config";

export interface HistoryEntry {
  text: string;
  caret: number | null;
}

interface StoredEntry extends HistoryEntry {
  kind: "base" | "type" | "chunk";
  lastAt: number;
}

export interface NoteHistory {
  entries: StoredEntry[];
  index: number;
}

export function createHistory(text: string): NoteHistory {
  return { entries: [{ text, caret: null, kind: "base", lastAt: 0 }], index: 0 };
}

export function reset(history: NoteHistory, text: string): void {
  history.entries = [{ text, caret: null, kind: "base", lastAt: 0 }];
  history.index = 0;
}

export function record(
  history: NoteHistory,
  text: string,
  caret: number | null,
  kind: "type" | "chunk",
  now: number,
): void {
  const current = history.entries[history.index];
  if (current?.text === text) return;

  history.entries = history.entries.slice(0, history.index + 1);
  const previous = history.entries[history.entries.length - 1];
  if (kind === "type" && previous?.kind === "type" && now - previous.lastAt < NOTE_UNDO_COALESCE_MS) {
    history.entries[history.entries.length - 1] = { text, caret, kind, lastAt: now };
    history.index = history.entries.length - 1;
    return;
  }

  history.entries.push({ text, caret, kind, lastAt: now });
  while (history.entries.length > NOTE_UNDO_LIMIT) {
    history.entries.shift();
    history.index = Math.max(0, history.index - 1);
  }
  history.index = history.entries.length - 1;
}

export function undo(history: NoteHistory): HistoryEntry | null {
  if (history.index <= 0) return null;
  history.index -= 1;
  const entry = history.entries[history.index];
  return { text: entry.text, caret: entry.caret };
}
