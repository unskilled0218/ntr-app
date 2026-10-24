// The note pane: a single contenteditable surface that is both editor and live Markdown preview,
// with autosave and out-of-band conflict handling. This is the most delicate port (web/app.js's
// note section); the contenteditable is driven IMPERATIVELY through the ported caret/markdown
// helpers, never as a controlled React node.
//
// THE CONTENTEDITABLE INVARIANT: the editor <div> is rendered child-free; React never puts
// children into it. ALL of its DOM is written by setEditorText/the caret helpers via editorRef.
// If React ever rendered children here it would clobber the caret and the live markup.

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { captureTransport, errMsg, getNote, isTransportCurrent, putNote, type TransportContext } from "../api";
import { NOTE_SAVE_DELAY_MS } from "../config";
import { getCaret, getCaretRange, readNoteText, setCaretRange, setEditorText } from "../lib/caret";
import { writeClipboard } from "../lib/clipboard";
import { setEditLine } from "../lib/editLine";
import { createHistory, record, reset, undo } from "../lib/history";
import { cutRange, dedentRange } from "../lib/noteEdit";
import { classifyNoteEvent } from "../lib/noteSync";
import { ResourceRefresh } from "../lib/resourceRefresh";
import NoteConflictDialog from "./NoteConflictDialog";
import OpenLinkDialog from "./OpenLinkDialog";
import { useLinkGestures } from "./useLinkGestures";

export interface NotePaneHandle {
  onNoteChange: () => void;
}

// View generations and certificate policy can change while a write still targets
// the same storage. Only a different URL or local directory gets another slot.
function noteDestination(owner: TransportContext): string {
  return owner.url ? `server:${owner.url}` : `local:${owner.localGeneration}`;
}

interface NoteSaveAttempt {
  owner: TransportContext;
  life: number;
}

const NotePane = forwardRef<NotePaneHandle>((_, ref) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const links = useLinkGestures();

  // The note text as last successfully persisted. The editor is "dirty" when it differs.
  const savedNote = useRef("");
  const noteSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteSaves = useRef(new Map<string, NoteSaveAttempt>());
  const composingNote = useRef(false); // true between compositionstart/end (IME safety)
  const history = useRef(createHistory(""));
  const mounted = useRef(false);
  const lifetime = useRef(0);
  const context = useRef(captureTransport());
  const baselineRevision = useRef(0);
  const transferredDraft = useRef(false);
  const conflictContext = useRef<TransportContext | null>(null);
  const saveError = useRef<string | null>(null);
  const recovery = useRef<ResourceRefresh | null>(null);
  // While a live update conflicts with unsaved edits, holds the incoming remote text awaiting the
  // user's choice (null = none). An empty remote note also blocks saves.
  const noteConflict = useRef<string | null>(null);

  const [status, setStatus] = useState<{ msg: string; isError: boolean }>({ msg: "", isError: false });
  const [conflictMine, setConflictMine] = useState("");
  const [conflictTheirs, setConflictTheirs] = useState("");
  const [conflictOpen, setConflictOpen] = useState(false);

  const editor = () => editorRef.current!;
  const noteDirty = () => readNoteText(editor()) !== savedNote.current;
  const noteSaving = () => noteSaves.current.has(noteDestination(context.current));
  const setNoteStatus = (msg: string, isError: boolean) => setStatus({ msg, isError });

  // Reveal the raw Markdown on whichever line the caret is on (collapse every other line's links). null
  // node when the editor is unfocused, which collapses every line.
  const markEditLine = () => {
    const sel = window.getSelection();
    const focused = document.activeElement === editor() && sel && sel.rangeCount > 0;
    setEditLine(editor(), focused ? sel!.getRangeAt(0).startContainer : null);
  };

  // The component's single editor-write path: render text + restore caret (the shared setEditorText),
  // then re-tag the caret's line so its links reveal. Every render path goes through here, so the reveal
  // cannot drift out of sync with a render (re-rendering innerHTML drops the .md-edit class).
  const paint = (text: string, caret: number | null) => {
    setEditorText(editor(), text, caret);
    markEditLine();
  };

  // (Re)arm the debounce: a save fires NOTE_SAVE_DELAY_MS after the last keystroke.
  const scheduleNoteSave = () => {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    if (!mounted.current || recovery.current?.busy || noteConflict.current !== null || transferredDraft.current) return;
    noteSaveTimer.current = setTimeout(flushNote, NOTE_SAVE_DELAY_MS);
  };

  // A context change preserves a dirty draft, but never carries its autosave to
  // another server. The new remote becomes a conflict requiring an explicit choice.
  function syncContext() {
    if (isTransportCurrent(context.current)) return;
    const next = captureTransport();
    const targetChanged = context.current.url !== next.url
      || (!next.url && context.current.localGeneration !== next.localGeneration);
    transferredDraft.current = transferredDraft.current || (targetChanged && noteDirty());
    context.current = next;
    baselineRevision.current++;
    noteConflict.current = null;
    conflictContext.current = null;
    setConflictOpen(false);
    saveError.current = null;
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    recovery.current?.cancel();
  }

  function requestNote() {
    if (!mounted.current) return;
    syncContext();
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    recovery.current!.request();
  }

  // Persist the note now if it is dirty and no save is already running. On completion it re-checks
  // for edits made during the PUT and re-arms the debounce, so the newest text is never left
  // unsaved. Used by the debounce, by blur, and after a conflict "keep mine".
  async function flushNote(authorized = false) {
    if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
    noteSaveTimer.current = null;
    if (!mounted.current) return;
    if (!isTransportCurrent(context.current)) { requestNote(); return; }
    if (composingNote.current) return; // never persist an IME's transient preedit
    if (noteConflict.current !== null) return;
    if (!authorized && (recovery.current?.busy || transferredDraft.current)) return;
    if (noteSaving()) return; // single-flight for this destination, not just this view
    if (!noteDirty()) return;
    const text = readNoteText(editor());
    const owner = context.current;
    const life = lifetime.current;
    const destination = noteDestination(owner);
    const attempt = { owner, life };
    baselineRevision.current++;
    noteSaves.current.set(destination, attempt);
    setNoteStatus("Saving…", false);
    try {
      await putNote(text, owner);
      if (!mounted.current || life !== lifetime.current || !isTransportCurrent(owner)) return;
      savedNote.current = text;
      saveError.current = null;
      setNoteStatus("Saved", false);
    } catch (err) {
      if (!mounted.current || life !== lifetime.current || !isTransportCurrent(owner)) return;
      saveError.current = `Could not save note: ${errMsg(err)}`;
      setNoteStatus(saveError.current, true);
    } finally {
      // Invalidating a view does not cancel its PUT. Release only this attempt,
      // even when another destination is now active or the pane has unmounted.
      if (noteSaves.current.get(destination) === attempt) noteSaves.current.delete(destination);
      if (mounted.current && life === lifetime.current && noteDestination(captureTransport()) === destination) {
        if (!isTransportCurrent(owner)) {
          // The old result cannot rebase the new view. Fetch current storage
          // before permitting another save, preserving later input as a draft.
          requestNote();
        } else {
          baselineRevision.current++;
          await recovery.current?.resume();
          if (!saveError.current && noteDirty()) scheduleNoteSave();
        }
      }
    }
  }

  // Best-effort save when the page is going away. The normal path will have saved earlier; this
  // only covers the last unsaved edit (no await possible on unload).
  const flushNoteBeacon = () => {
    if (!isTransportCurrent(context.current) || composingNote.current || noteSaving()
      || recovery.current?.busy || noteConflict.current !== null || transferredDraft.current) return;
    if (!noteDirty()) return;
    // Keep unload best-effort, but acquire the same slot as ordinary saves.
    void flushNote().catch(() => {});
  };

  // Make the editor show `text` as the saved, clean note: new base, render in place, clear status.
  const adoptNote = (text: string) => {
    const selection = document.activeElement === editor() ? getCaretRange(editor()) : null;
    savedNote.current = text;
    saveError.current = null;
    baselineRevision.current++;
    reset(history.current, text);
    paint(text, null);
    if (selection) { setCaretRange(editor(), selection.start, selection.end); markEditLine(); }
    setNoteStatus("", false);
  };

  // Fetch the backend's note and bring the editor in line with it: silently when nothing would be
  // lost (noop / in-sync / adopt) or by prompting when unsaved edits differ (conflict).
  async function reconcileNote() {
    const owner = context.current;
    const life = lifetime.current;
    const revision = baselineRevision.current;
    let remote: string;
    try { remote = await getNote(owner); }
    catch (error) {
      if (!mounted.current || life !== lifetime.current || !isTransportCurrent(owner)) return;
      throw error;
    }
    if (!mounted.current || life !== lifetime.current || !isTransportCurrent(owner)) return;
    if (revision !== baselineRevision.current || noteSaving() || composingNote.current) {
      recovery.current!.pending = true;
      return;
    }
    if (noteConflict.current !== null || transferredDraft.current) {
      openNoteConflict(remote);
      return;
    }
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

  if (!recovery.current) recovery.current = new ResourceRefresh(reconcileNote, {
    canRun: () => mounted.current && !noteSaving() && !composingNote.current && isTransportCurrent(context.current),
    onError: (error) => setNoteStatus([saveError.current, `Could not load note: ${errMsg(error)}`].filter(Boolean).join("; "), true),
    onIdle: () => { if (!saveError.current && noteDirty()) scheduleNoteSave(); },
  });

  // A remote change collided with unsaved edits: show both versions. Set the ref BEFORE opening so
  // the blur it triggers hits flushNote's conflict guard. If already open (a later event arrived
  // mid-conflict), just refresh the incoming version rather than re-opening.
  function openNoteConflict(remote: string) {
    const wasOpen = noteConflict.current !== null;
    noteConflict.current = remote;
    conflictContext.current = context.current;
    setConflictTheirs(remote);
    if (wasOpen) return;
    setConflictMine(readNoteText(editor()));
    setConflictOpen(true);
  }

  // Resolve the pending conflict. Idempotent (the button click closes the dialog, whose close
  // event calls this again — the second call no-ops). "Use theirs" discards local edits; "keep
  // mine" treats remote as the new base and saves local over it. Escape routes here as keep-mine.
  function resolveNoteConflict(useTheirs: boolean) {
    if (noteConflict.current === null) return;
    if (!conflictContext.current || !isTransportCurrent(conflictContext.current)) { requestNote(); return; }
    const remote = noteConflict.current;
    noteConflict.current = null;
    conflictContext.current = null;
    transferredDraft.current = false;
    baselineRevision.current++;
    setConflictOpen(false);
    if (useTheirs) {
      adoptNote(remote);
      void recovery.current?.resume();
    } else {
      savedNote.current = remote; // their version is the base; editor is dirty against it...
      void flushNote(true); // explicit choice authorizes this scoped overwrite
    }
  }

  const noteEdited = (text: string, caret: number | null, kind: "type" | "chunk") => {
    saveError.current = null;
    record(history.current, text, caret, kind, Date.now());
    setNoteStatus("Editing…", false);
    scheduleNoteSave();
  };

  const undoNote = () => {
    const entry = undo(history.current);
    if (!entry) return;
    paint(entry.text, entry.caret);
    saveError.current = null;
    setNoteStatus("Editing…", false);
    scheduleNoteSave();
  };

  const clipLine = async (cut: boolean) => {
    const text = readNoteText(editor());
    const range = getCaretRange(editor());
    const start = range?.start ?? text.length;
    const end = range?.end ?? start;
    const next = cutRange(text, start, end);

    if (cut) {
      paint(next.text, next.caret);
      noteEdited(next.text, next.caret, "chunk");
    }

    try {
      await writeClipboard(next.copied);
    } catch (err) {
      setNoteStatus(`Could not copy: ${errMsg(err)}`, true);
    }
  };

  // Insert `insert` over the selected range, operating on the logical text so the DOM stays flat
  // (one div per line). Used by Enter ("\n"), Space, Tab, and paste (clipboard text/plain).
  const spliceNote = (insert: string) => {
    const text = readNoteText(editor());
    const range = getCaretRange(editor());
    const start = range?.start ?? text.length;
    const end = range?.end ?? start;
    const next = text.slice(0, start) + insert + text.slice(end);
    const caret = start + insert.length;
    paint(next, caret);
    noteEdited(next, caret, "chunk");
  };

  const dedentNote = () => {
    const text = readNoteText(editor());
    const range = getCaretRange(editor());
    const start = range?.start ?? text.length;
    const end = range?.end ?? start;
    const next = dedentRange(text, start, end);
    if (!next.changed) return;
    setEditorText(editor(), next.text, null);
    setCaretRange(editor(), next.start, next.end);
    markEditLine();
    noteEdited(next.text, next.start, "chunk");
  };

  // Initial load + page-close beacon. Run once.
  useEffect(() => {
    mounted.current = true;
    lifetime.current++;
    requestNote();
    window.addEventListener("pagehide", flushNoteBeacon);
    return () => {
      mounted.current = false;
      lifetime.current++;
      baselineRevision.current++;
      composingNote.current = false;
      recovery.current?.cancel();
      if (noteSaveTimer.current) clearTimeout(noteSaveTimer.current);
      noteSaveTimer.current = null;
      window.removeEventListener("pagehide", flushNoteBeacon);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Caret moves from plain clicks and arrow keys do not fire onInput, so the edit-line reveal is driven
  // from selectionchange. It guards on focus FIRST, so a selection change elsewhere in the app returns
  // immediately rather than walking the note's lines; collapse-on-leave is handled by onBlur. Toggling a
  // class never touches the selection, so this cannot re-enter via selectionchange.
  useEffect(() => {
    const onSelect = () => {
      if (composingNote.current || document.activeElement !== editor()) return;
      markEditLine();
    };
    document.addEventListener("selectionchange", onSelect);
    return () => document.removeEventListener("selectionchange", onSelect);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useImperativeHandle(ref, () => ({ onNoteChange: requestNote }));

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
          if (composingNote.current) {
            setNoteStatus("Editing…", false);
            return;
          }
          const text = readNoteText(editor());
          const caret = getCaret(editor());
          noteEdited(text, caret, "type");
          paint(text, caret);
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || composingNote.current) return;
          const shortcut = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
          if (shortcut && e.key.toLowerCase() === "z") {
            e.preventDefault();
            undoNote();
            return;
          }
          if (shortcut && e.key.toLowerCase() === "x") {
            e.preventDefault();
            void clipLine(true);
            return;
          }
          if (shortcut && e.key.toLowerCase() === "c") {
            e.preventDefault();
            void clipLine(false);
            return;
          }
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          if (e.key === "Enter") {
            e.preventDefault();
            spliceNote("\n");
          } else if (e.key === " ") {
            e.preventDefault();
            spliceNote(" ");
          } else if (e.key === "Tab" && e.shiftKey) {
            e.preventDefault();
            dedentNote();
          } else if (e.key === "Tab") {
            e.preventDefault();
            spliceNote("\t");
          }
        }}
        onPaste={(e) => {
          e.preventDefault();
          spliceNote(e.clipboardData.getData("text/plain"));
        }}
        {...links.handlers}
        onBlur={() => {
          void flushNote();
          setEditLine(editor(), null); // collapse every link when focus leaves the note
        }}
        onFocus={requestNote}
        onCompositionStart={() => {
          composingNote.current = true;
        }}
        onCompositionEnd={() => {
          composingNote.current = false;
          const text = readNoteText(editor());
          const caret = getCaret(editor());
          paint(text, caret);
          noteEdited(text, caret, "chunk");
          void recovery.current?.resume();
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

      <OpenLinkDialog url={links.pending} onConfirm={links.confirm} onCancel={links.dismiss} />
    </section>
  );
});

NotePane.displayName = "NotePane";
export default NotePane;
