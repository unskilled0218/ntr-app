import { useEffect, type RefObject } from "react";

// Dismiss a modal <dialog> when the user clicks outside its box (the backdrop). A modal dialog
// paints its own ::backdrop, so a click there lands on the dialog element itself while a click on
// any inner control targets that control — hence `e.target === dialog` is "clicked the backdrop".
// One home for "click outside closes", wired by every dialog. By default it calls the dialog's own
// close(), whose native `close` event each dialog already handles; the two dialogs that drive
// open/closed through React state (SettingsModal, EditTaskModal) pass their own close instead, so
// that state stays the single source of truth. Nesting works for free: a click on an inner dialog's
// backdrop has the inner dialog as its target, so the outer dialog's listener ignores it.
export function useBackdropClose(dialogRef: RefObject<HTMLDialogElement | null>, onClose?: () => void) {
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const dismiss = onClose ?? (() => dialog.close());
    const onClick = (e: MouseEvent) => {
      if (e.target === dialog) dismiss();
    };
    dialog.addEventListener("click", onClick);
    return () => dialog.removeEventListener("click", onClick);
  }, [dialogRef, onClose]);
}
