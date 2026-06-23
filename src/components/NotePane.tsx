// The note pane: a single contenteditable surface that is both editor and live Markdown preview,
// with autosave and out-of-band conflict handling. This is the most delicate port (web/app.js's
// note section); the contenteditable is driven IMPERATIVELY through the ported caret/markdown
// helpers, never as a controlled React node.
//
// THE CONTENTEDITABLE INVARIANT: the editor <div> is rendered child-free; React never puts
// children into it. ALL of its DOM is written by setEditorText/the caret helpers via editorRef.
// If React ever rendered children here it would clobber the caret and the live markup.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { getNote, putNote } from "../api";
import { NOTE_SAVE_DELAY_MS } from "../config";
import { getCaret, readNoteText, setEditorText } from "../lib/caret";
import { classifyNoteEvent } from "../lib/noteSync";
import NoteConflictDialog from "./NoteConflictDialog";

export interface NotePaneHandle {
  onNoteChange: () => void;
}

const NotePane = forwardRef<NotePaneHandle>((_, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);

  // The note text as last successfully persisted. The editor is "dirty" when it differs.
  const savedNote = useRef("");
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingNote = useRef(false); // single-flight guard for an in-flight PUT
  const composingNote = useRef(false); // true between compositionstart/end (IME safety)
  // While a live update conflicts with unsaved edits, holds the incoming remote text awaiting the
  // user's choice (null = none). Truthy means the dialog owns the note: it blocks reloads and saves.
  const noteConflict = useRef<string | null>(null);

  const [status, setStatus] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false });
  const [conflictMine, setConflictMine] = useState("");
  const [conflictTheirs, setConflictTheirs] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);

  const editor = () => editorRef.current!;
  const noteDirty = () => readNoteText(editor()) !== savedNote.current;
  const setNoteStatus = (msg: string, isError: boolean) => setStatus({ msg, isError });

  // (Re)arm the debounce: a save fires NOTE_SAVE_DELAY_MS after the last keystroke.
  const scheduleNoteSave = () => {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = setTimeout(flushNote, NOTE_SAVE_DELAY_MS);
  };

  // Persist the note now if it is dirty and no save is already running. On completion it re-checks
  // for edits made during the PUT and re-arms the debounce, so the newest text is never left
  // unsaved. Used by the debounce, by blur, and after a conflict "keep mine".
  async function flushNote() {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    if (noteConflict.current) return; // a conflict is pending; don't push local up until resolved
    if (savingNote.current) return; // single-flight
    if (!noteDirty()) return;
    const text = readNoteText(editor());
    savingNote.current = true;
    setNoteStatus("Saving…", false);
    try {
      await putNote(text);
      savedNote.current = text;
      setNoteStatus("Saved", false);
      if (noteDirty()) scheduleNoteSave(); // typed during the PUT — persist the newest too
    } catch (err) {
      setNoteStatus(`Could not save note: ${(err as Error).message ?? err}`, true);
    } finally {
      savingNote.current = false;
    }
  }

  // Best-effort save when the page is going away. The normal path will have saved earlier; this
  // only covers the last unsaved edit (no await possible on unload).
  const flushNoteBeacon = () => {
    if (!noteDirty()) return;
    putNote(readNoteText(editor())).catch(() => {});
  };

  // Make the editor show `text` as the saved, clean note: new base, render in place, clear status.
  const adoptNote = (text: string) => {
    savedNote.current = text;
    setEditorText(editor(), text, null);
    setNoteStatus("", false);
  };

  async function loadNote() {
    try {
      adoptNote(await getNote());
    } catch (err) {
      setNoteStatus(`Could not load note: ${(err as Error).message ?? err}`, true);
    }
  }

  // Fetch the backend's note and bring the editor in line with it: silently when nothing would be
  // lost (noop / in-sync / adopt) or by prompting when unsaved edits differ (conflict).
  async function reconcileNote() {
    if (savingNote.current || noteConflict.current) return;
    let remote: string;
    try {
      remote = await getNote();
    } catch {
      return; // transient; a later event or the next focus retries
    }
    if (savingNote.current || noteConflict.current) return; // re-check after the await
    const local = readNoteText(editor());
    switch (classifyNoteEvent(savedNote.current, local, remote)) {
      case "noop":
        break;
      case "adopt":
        adoptNote(remote);
        break;
      case "in-sync":
        savedNote.current = remote;
        break;
      case "conflict":
        openNoteConflict(remote);
        break;
    }
  }

  // The note side of a live update. A focused editor with no unsaved edits is left alone so a
  // mid-session event does not yank the caret — the focus re-check / blur flush reconcile that.
  async function maybeReloadNote() {
    if (!noteDirty() && document.activeElement === editor()) return;
    await reconcileNote();
  }

  // A remote change collided with unsaved edits: show both versions. Set the ref BEFORE opening so
  // the blur it triggers hits flushNote's conflict guard. If already open (a later event arrived
  // mid-conflict), just refresh the incoming version rather than re-opening.
  function openNoteConflict(remote: string) {
    const wasOpen = noteConflict.current !== null;
    noteConflict.current = remote;
    setConflictTheirs(remote);
    if (wasOpen) return;
    setConflictMine(readNoteText(editor()));
    setConflictOpen(true);
  }

  // Resolve the pending conflict. Idempotent (the button click closes the dialog, whose close
  // event calls this again — the second call no-ops). "Use theirs" discards local edits; "keep
  // mine" treats remote as the new base and saves local over it. Escape routes here as keep-mine.
  function resolveNoteConflict(useTheirs: boolean) {
    if (!noteConflict.current) return;
    const remote = noteConflict.current;
    noteConflict.current = null;
    setConflictOpen(false);
    if (useTheirs) {
      adoptNote(remote);
    } else {
      savedNote.current = remote; // their version is the base; editor is dirty against it...
      flushNote(); // ...so this PUTs the local text and it wins
    }
  }

  // Re-highlight in place, preserving the caret.
  const rerenderNote = () => setEditorText(editor(), readNoteText(editor()), getCaret(editor()));

  // Insert `insert` at the caret, operating on the logical text so the DOM stays flat (one div per
  // line). Used by Enter ("\n") and paste (clipboard text/plain).
  const spliceNote = (insert: string) => {
    const text = readNoteText(editor());
    const at = getCaret(editor()) ?? text.length;
    setEditorText(editor(), text.slice(0, at) + insert + text.slice(at), at + insert.length);
    setNoteStatus("Editing…", false);
    scheduleNoteSave();
  };

  // Initial load + page-close beacon. Run once.
  useEffect(() => {
    loadNote();
    window.addEventListener("pagehide", flushNoteBeacon);
    return () => window.removeEventListener("pagehide", flushNoteBeacon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({ onNoteChange: () => void maybeReloadNote() }));

  return (
    <section className="pane note-pane" id="note-view">
      <h1>note</h1>
      <div
        id="note-input"
        ref={editorRef}
        className="note-input is-empty"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Note (Markdown)"
        data-placeholder="Notes (Markdown)…"
        onInput={() => {
          setNoteStatus("Editing…", false);
          scheduleNoteSave();
          if (!composingNote.current) rerenderNote();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            spliceNote("\n");
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          spliceNote(e.clipboardData.getData("text/plain"));
        }}
        onBlur={() => void flushNote()}
        onFocus={() => void reconcileNote()}
        onCompositionStart={() => {
          composingNote.current = true;
        }}
        onCompositionEnd={() => {
          composingNote.current = false;
          rerenderNote();
        }}
      />
      <div className="note-bar">
        <span id="note-status" className={"note-status" + (status.isError ? " is-error" : "")} role="status">
          {status.msg}
        </span>
      </div>

      <NoteConflictDialog
        open={conflictOpen}
        mine={conflictMine}
        theirs={conflictTheirs}
        onKeepMine={() => resolveNoteConflict(false)}
        onUseTheirs={() => resolveNoteConflict(true)}
        onClose={() => resolveNoteConflict(false)}
      />
    </section>
  );
});

NotePane.displayName = "NotePane";
export default NotePane;
