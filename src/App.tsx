// Top-level layout: the two panes, the bottom nav, the mobile view state + swipe, the live
// `change` subscription, and the settings modal. Ported from the <main>/nav shell + the mobile
// view-switching and SSE wiring of web/app.js. The button/swipe order both derive from VIEWS.

import { useEffect, useRef, useState } from "react";
import "./style.css";
import {
  CHANGE_NOTE,
  CHANGE_TASKS,
  activateTransport,
  captureTransport,
  destination,
  isTransportCurrent,
  onChange,
  reconcileWithServer,
  resolveConflict,
  type Conflict,
  type ConflictChoice,
} from "./api";
import { getCompactUi, getLastView, getStartupView, setLastView } from "./settings";
import { SWIPE_MIN, VIEWS, type View } from "./config";
import NotePane, { type NotePaneHandle } from "./components/NotePane";
import TodoPane, { type TodoPaneHandle } from "./components/TodoPane";
import SettingsButton from "./components/SettingsButton";
import SettingsModal from "./components/SettingsModal";
import ConflictDialog from "./components/ConflictDialog";
import RemoteUpdateDialog from "./components/RemoteUpdateDialog";
import { RemoteUpdates, type Offer } from "./lib/remoteUpdates";

export default function App() {
  const [view, setView] = useState<View>(() => {
    const startup = getStartupView();
    return startup === "last" ? getLastView() : startup;
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  // The compact-controls layout choice; re-read from settings on close (the modal covers the view,
  // so applying live behind it would be invisible — same "apply on close" model as the others).
  const [compact, setCompact] = useState(getCompactUi);
  // Bumped only when settings change the transport; unchanged settings leave the subscription alone.
  const [connectionKey, setConnectionKey] = useState(0);
  const [destinationKey, setDestinationKey] = useState(0);
  const [ready, setReady] = useState(false);
  const initializedDestination = useRef<number | null>(null);
  const [updates] = useState(() => new RemoteUpdates());
  const [, redraw] = useState(0);
  const activeContext = useRef(captureTransport());
  const [noteDialog, setNoteDialog] = useState(false);
  const [taskDialog, setTaskDialog] = useState(false);
  const [otherDialog, setOtherDialog] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => setOtherDialog(!!document.querySelector("dialog[open]:not(#remote-update)")));
    observer.observe(document.body, { attributes: true, attributeFilter: ["open"], subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => updates.subscribe(() => redraw((n) => n + 1)), [updates]);
  useEffect(() => { updates.resume(); return () => updates.cancel(); }, [updates]);
  // Outstanding server/local divergences awaiting a user choice, handled one at a time.
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const noteRef = useRef<NotePaneHandle>(null);
  const todoRef = useRef<TodoPaneHandle>(null);
  const navRef = useRef<HTMLElement>(null);
  const swipeStartX = useRef<number | null>(null);
  const swipeStartY = useRef<number | null>(null);

  // On first initialization and genuine destination changes: reconcile local files with the server.
  // Auto-resolved divergences are written through; the rest (strategy "ask") queue for the
  // ConflictDialog below. Guarded against a late resolve after the transport changed again.
  useEffect(() => {
    if (initializedDestination.current === destinationKey) return;
    let cancelled = false;
    const controller = new AbortController();
    const context = captureTransport();
    reconcileWithServer(context, controller.signal).then((found) => {
      if (!cancelled && isTransportCurrent(context)) {
        initializedDestination.current = destinationKey;
        setConflicts(found);
        setReady(true);
        if (destinationKey && !found.length) refreshPanes();
      }
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [destinationKey, connectionKey]);

  function refreshPanes() {
    todoRef.current?.onTasksChanged();
    noteRef.current?.onNoteChange();
  }

  // Resolve the head conflict (choice) or dismiss it (null), then advance the queue.
  // Refresh is tied to a write actually landing, not to queue position.
  async function endConflict(choice: ConflictChoice | null) {
    const context = captureTransport();
    const [head, ...rest] = conflicts;
    if (choice && head) {
      try {
        await resolveConflict(head, choice);
        if (isTransportCurrent(context)) {
          updates.initialize(head.resource);
        }
      } catch (e) {
        console.warn("conflict resolution failed:", e);
      }
    }
    if (isTransportCurrent(context)) {
      setConflicts(rest);
      if (!rest.length) refreshPanes();
    }
  }

  // The live stream detects remote changes without adopting them; local watcher events retain
  // their pane refresh behavior. Re-wire only when connectionKey identifies a replacement transport.
  useEffect(() => {
    const controller = new AbortController();
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    const context = captureTransport();
    const changed = (kind: string) => {
      if (context.url) {
        if (kind === CHANGE_TASKS || kind === CHANGE_NOTE) updates.request(kind);
      } else if (initializedDestination.current !== destinationKey) return;
      else if (kind === CHANGE_TASKS) todoRef.current?.onTasksChanged();
      else if (kind === CHANGE_NOTE) noteRef.current?.onNoteChange();
    };
    onChange((kind) => {
      changed(kind);
    }, { signal: controller.signal, onConnected: () => {
      changed(CHANGE_TASKS); changed(CHANGE_NOTE);
    } }).then((un) => {
      if (cancelled) un();
      else unlisten = un;
    }).catch((error) => console.warn("live subscription failed:", error));
    return () => {
      cancelled = true;
      controller.abort();
      unlisten?.();
    };
  }, [connectionKey]); // onChange is module-stable; refs excluded by React convention

  function onSettingsClose() {
    setSettingsOpen(false);
    setCompact(getCompactUi()); // pick up a compact-controls toggle made in the modal
    const before = activeContext.current;
    const next = captureTransport();
    if (before.url === next.url && before.allowInvalidCert === next.allowInvalidCert
      && before.generation === next.generation) return;
    const context = activateTransport();
    activeContext.current = context;
    updates.activate(context);
    setConnectionKey((k) => k + 1);
    if (destination(before) !== destination(context)) {
      noteRef.current?.prepareDestination();
      setConflicts([]);
      setDestinationKey((k) => k + 1);
    } else {
      // Rebind persistence ownership without granting remote approval.
      refreshPanes();
    }
  }

  async function acceptUpdate(offer: Offer) {
    const token = await updates.prepare(offer);
    if (!token) return;
    if (token.resource === "note") noteRef.current?.applyRemote(token as import("./lib/remoteUpdates").ApplicationToken<"note">);
    else await todoRef.current?.applyRemote(token as import("./lib/remoteUpdates").ApplicationToken<"tasks">);
  }
  const offered = (["tasks", "note"] as const).map((resource) => updates.state(resource))
    .find((state) => state.pending && (state.phase === "offered" || state.phase === "applying"));
  const visibleOffer = settingsOpen || conflicts.length || noteDialog || taskDialog || otherDialog || !ready ? null : offered?.pending ?? null;

  // "Are we in the mobile single-pane layout?" — read CSS's own decision (the bottom bar is
  // display:none on desktop, shown on mobile) instead of re-encoding the 720px breakpoint here.
  const onMobile = () => (navRef.current ? getComputedStyle(navRef.current).display !== "none" : false);

  function selectView(v: View) {
    setView(v);
    setLastView(v);
  }

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
    if (next >= 0 && next < VIEWS.length) selectView(VIEWS[next]);
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
        {ready && <NotePane ref={noteRef} updates={updates} onDialogChange={setNoteDialog} />}
        {ready && <TodoPane ref={todoRef} compact={compact} updates={updates} onDialogChange={setTaskDialog} />}
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
            onClick={() => selectView(v)}
          >
            {v === "note" ? "Note" : "Todo"}
          </button>
        ))}
        <SettingsButton onOpen={openSettings} />
      </nav>

      <SettingsModal open={settingsOpen} onClose={onSettingsClose} />
      <aside className="remote-updates" aria-label="Remote updates">
        {(["tasks", "note"] as const).map((resource) => {
          const state = updates.state(resource);
          return (state.pending || state.error) && <div key={resource} role="status">
            {state.error || (resource === "note" ? "Remote update pending; automatic saving paused" : "Tasks update pending")}
            <button type="button" onClick={() => {
              if (resource === "tasks") todoRef.current?.reviewRemote();
              void updates.review(resource);
            }}>Review update<span className="sr-only"> for {resource}</span></button>
          </div>;
        })}
      </aside>
      <RemoteUpdateDialog offer={visibleOffer} busy={offered?.phase === "applying"} error={offered?.error ?? ""}
        onUpdate={(offer) => { void acceptUpdate(offer); }} onDismiss={(offer) => updates.defer(offer.resource)} />
      <ConflictDialog
        conflict={conflicts[0] ?? null}
        onChoose={endConflict}
        onDismiss={() => endConflict(null)}
      />
    </main>
  );
}
