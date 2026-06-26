import { useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { LONG_PRESS_MS } from "../config";
import { openLink } from "../lib/openLink";

// The .md-link element under an event target, or null. Gestures identify a link purely by this element
// (its data-href is the raw URL), so the hook needs no editor ref and stays decoupled from the caret/
// render path.
const linkAt = (target: EventTarget | null): HTMLElement | null =>
  target instanceof Element ? (target.closest("a.md-link") as HTMLElement | null) : null;

// Open-link gestures for the note editor, kept off the plain click so a tap always edits:
//   desktop -> Ctrl/Cmd + click opens immediately;
//   touch   -> a press held LONG_PRESS_MS (without moving/lifting) raises the confirm modal, whose URL is
//              returned as `pending`; a move/lift/cancel before then aborts.
// The handlers are additive: a plain click falls through to the browser's default caret placement.
export function useLinkGestures() {
  const [pending, setPending] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onClick = (e: ReactMouseEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return; // plain click edits; only the modifier opens
    const url = linkAt(e.target)?.dataset.href;
    if (!url) return;
    e.preventDefault();
    openLink(url);
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType !== "touch") return; // long-press is the touch gesture only
    const url = linkAt(e.target)?.dataset.href;
    if (!url) return;
    cancel();
    timer.current = setTimeout(() => setPending(url), LONG_PRESS_MS);
  };

  const onContextMenu = (e: ReactMouseEvent) => {
    if (linkAt(e.target)) e.preventDefault(); // suppress the native menu; our modal replaces it
  };

  return {
    handlers: {
      onClick,
      onPointerDown,
      onPointerMove: cancel,
      onPointerUp: cancel,
      onPointerCancel: cancel,
      onContextMenu,
    },
    pending,
    confirm: () => {
      if (pending) openLink(pending);
      setPending(null);
    },
    dismiss: () => setPending(null),
  };
}
