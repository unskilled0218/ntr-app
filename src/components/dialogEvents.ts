import type { SyntheticEvent } from "react";

// React propagates even non-bubbling native dialog events through its ancestor tree.
export function ownDialogEvent(event: SyntheticEvent<HTMLDialogElement>) {
  if (event.target !== event.currentTarget) return false;
  event.stopPropagation();
  return true;
}

// A queued close from a previous presentation must not dismiss a reopened dialog.
export function dialogWasDismissed(event: SyntheticEvent<HTMLDialogElement>) {
  return ownDialogEvent(event) && !event.currentTarget.open;
}
