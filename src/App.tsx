// Top-level layout: the two panes, the bottom nav, the mobile view state + swipe, the live
// `change` subscription, and the settings modal. Ported from the <main>/nav shell + the mobile
// view-switching and SSE wiring of web/app.js. The button/swipe order both derive from VIEWS.

import { useEffect, useRef, useState } from "react";
import "./style.css";
import {
  CHANGE_NOTE,
  CHANGE_TASKS,
  onChange,
  reconcileWithServer,
  resolveConflict,
  type Conflict,
  type ConflictChoice,
} from "./api";
import { getCompactUi } from "./settings";
import { SWIPE_MIN, VIEWS, type View } from "./config";
import NotePane, { type NotePaneHandle } from "./components/NotePane";
import TodoPane, { type TodoPaneHandle } from "./components/TodoPane";
import SettingsButton from "./components/SettingsButton";
import SettingsModal from "./components/SettingsModal";
import ConflictDialog from "./components/ConflictDialog";

export default function App() {
  const [view, setView] = useState<View>("note");
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The compact-controls layout choice; re-read from settings on close (the modal covers the view,
  // so applying live behind it would be invisible — same "apply on close" model as the others).
  const [compact, setCompact] = useState(getCompactUi);
  // Bumped on settings close to force the onChange useEffect to re-subscribe with the new transport.
  const [connectionKey, setConnectionKey] = useState(0);
  // Outstanding server/local divergences awaiting a user choice, handled one at a time.
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const noteRef = useRef<NotePaneHandle>(null);
  const todoRef = useRef<TodoPaneHandle>(null);
  const navRef = useRef<HTMLElement>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);

  // On mount and after every server-mode change: reconcile local files with the server.
  // Auto-resolved divergences are written through; the rest (strategy "ask") queue for the
  // ConflictDialog below. Guarded against a late resolve after the transport changed again.
  useEffect(() => {
    let cancelled = false;
    reconcileWithServer().then((found) => {
      if (!cancelled) setConflicts(found);
    });
    return () => {
      cancelled = true;
    };
  }, [connectionKey]);

  function refreshPanes() {
    todoRef.current?.onTasksChanged();
    noteRef.current?.onNoteChange();
  }

  // Resolve the head conflict (choice) or dismiss it (null), then advance the queue.
  // Refresh is tied to a write actually landing, not to queue position.
  async function endConflict(choice: ConflictChoice | null) {
    const [head, ...rest] = conflicts;
    if (choice && head) {
      try {
        await resolveConflict(head, choice);
        refreshPanes();
      } catch (e) {
        console.warn("conflict resolution failed:", e);
      }
    }
    setConflicts(rest);
  }

  // The live stream: a `change` event re-fetches tasks or reconciles the note. Re-wired whenever
  // connectionKey changes (i.e., after settings close) so the new transport is picked up.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onChange((kind) => {
      if (kind === CHANGE_TASKS) todoRef.current?.onTasksChanged();
      else if (kind === CHANGE_NOTE) noteRef.current?.onNoteChange();
    }).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [connectionKey]); // onChange is module-stable; refs excluded by React convention

  function onSettingsClose() {
    setSettingsOpen(false);
    setConnectionKey((k) => k + 1); // re-wire onChange subscription
    setCompact(getCompactUi()); // pick up a compact-controls toggle made in the modal
    // Explicit reload: mode may have changed, so both panes need fresh data.
    todoRef.current?.onTasksChanged();
    noteRef.current?.onNoteChange();
  }

  // "Are we in the mobile single-pane layout?" — read CSS's own decision (the bottom bar is
  // display:none on desktop, shown on mobile) instead of re-encoding the 720px breakpoint here.
  const onMobile = () => (navRef.current ? getComputedStyle(navRef.current).display !== "none" : false);

  function onTouchStart(e: React.TouchEvent) {
    if (!onMobile() || e.touches.length !== 1) {
      swipeStartX.current = null;
      return;
    }
    swipeStartX.current = e.touches[0].clientX;
    swipeStartY.current = e.touches[0].clientY;
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (swipeStartX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeStartX.current;
    const dy = e.changedTouches[0].clientY - (swipeStartY.current ?? 0);
    swipeStartX.current = null;
    // Ignore taps, short drags, and vertical-dominant drags (those scroll the pane).
    if (Math.abs(dx) < SWIPE_MIN || Math.abs(dx) <= Math.abs(dy)) return;
    const cur = VIEWS.indexOf(view);
    const next = cur + (dx < 0 ? 1 : -1); // swipe left → next view, right → previous
    if (next >= 0 && next < VIEWS.length) setView(VIEWS[next]);
  }

  const openSettings = () => setSettingsOpen(true);

  return (
    <main data-view={view}>
      {/* Desktop title row: app wordmark + the connection-settings badge in one line. Hidden on
          mobile (CSS), where the badge moves into the bottom nav below. */}
      <header className="app-header">
        <span className="app-title">ntr</span>
        <SettingsButton onOpen={openSettings} />
      </header>

      <div className="panes" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <NotePane ref={noteRef} />
        <TodoPane ref={todoRef} compact={compact} />
      </div>

      {/* View-button order must match VIEWS: swipe direction is computed from that array, so the
          bar's left-to-right order and the swipe order share one source of truth. The trailing
          settings badge is not a view (no data-view, not in VIEWS), so it does not affect swipe. */}
      <nav className="bottom-nav" aria-label="Switch view" ref={navRef}>
        {VIEWS.map((v) => (
          <button
            key={v}
            type="button"
            data-view={v}
            aria-controls={`${v}-view`}
            aria-current={view === v ? "page" : undefined}
            className={view === v ? "is-active" : undefined}
            onClick={() => setView(v)}
          >
            {v === "note" ? "Note" : "Todo"}
          </button>
        ))}
        <SettingsButton onOpen={openSettings} />
      </nav>

      <SettingsModal open={settingsOpen} onClose={onSettingsClose} />
      <ConflictDialog
        conflict={conflicts[0] ?? null}
        onChoose={endConflict}
        onDismiss={() => endConflict(null)}
      />
    </main>
  );
}
