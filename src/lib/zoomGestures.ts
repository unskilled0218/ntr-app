/** Block page zoom gestures without interfering with ordinary scrolling or keyboard input. */
export function installZoomGestureGuard(doc: Document): () => void {
  const options = { capture: true, passive: false };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey && event.cancelable) event.preventDefault();
  };
  const gesture = (event: Event) => {
    if (event.cancelable) event.preventDefault();
  };
  doc.addEventListener("wheel", wheel, options);
  doc.addEventListener("gesturestart", gesture, options);
  doc.addEventListener("gesturechange", gesture, options);
  return () => {
    doc.removeEventListener("wheel", wheel, options);
    doc.removeEventListener("gesturestart", gesture, options);
    doc.removeEventListener("gesturechange", gesture, options);
  };
}
