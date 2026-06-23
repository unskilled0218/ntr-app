// Top-level layout: the two panes, the bottom nav, the mobile view state + swipe, and the live
// `change` subscription that drives reconcile. Ported from the <main>/nav shell + the mobile
// view-switching and SSE wiring of web/app.js. The button/swipe order both derive from VIEWS.

import { useEffect, useRef, useState } from "react";
import "./style.css";
import { CHANGE_NOTE, CHANGE_TASKS, onChange } from "./api";
import { SWIPE_MIN, VIEWS, type View } from "./config";
import NotePane, { type NotePaneHandle } from "./components/NotePane";
import TodoPane, { type TodoPaneHandle } from "./components/TodoPane";

export default function App() {
  const [view, setView] = useState<View>("note");
  const noteRef = useRef<NotePaneHandle>(null);
  const todoRef = useRef<TodoPaneHandle>(null);
  const navRef = useRef<HTMLElement>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);

  // The live stream: a `change` event re-fetches tasks or reconciles the note, mirroring app.js's
  // EventSource handler. The watcher (src-tauri) is the only emitter; it covers out-of-band file
  // edits. A command's own mutation is reflected by the initiating pane's own refresh.
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
  }, []);

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

  return (
    <main data-view={view}>
      <div className="panes" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <NotePane ref={noteRef} />
        <TodoPane ref={todoRef} />
      </div>

      {/* Button order must match VIEWS: swipe direction is computed from that array, so the bar's
          left-to-right order and the swipe order share one source of truth. */}
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
      </nav>
    </main>
  );
}
