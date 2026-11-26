import { bindDismissListeners, bindListeners, mountPortal, positionAnchoredPortal } from "./dom";

/** Only open surfaces follow scrolling, resizing and the host dialog's transition. */
export function trackAnchoredPortal(panel: HTMLElement, anchor: HTMLElement, position: () => void, close: () => void): () => void {
  position();
  let frame = 0;
  const schedule = (event: Event) => {
    if (frame || (event.target instanceof Node && panel.contains(event.target))) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!anchor.isConnected) return close();
      position();
      const { left, top, width, height } = anchor.getBoundingClientRect();
      const hit = document.elementFromPoint?.(left + width / 2, top + height / 2);
      if (hit !== undefined && !anchor.contains(hit)) close();
    });
  };
  const viewport = { scroll: schedule, resize: schedule, transitionend: schedule };
  bindListeners(window, true, viewport, true);
  return () => {
    bindListeners(window, false, viewport, true);
    if (frame) cancelAnimationFrame(frame);
  };
}

export function openAnchoredDialog(
  panel: HTMLElement, anchor: HTMLElement, root: HTMLElement, close: (restoreFocus?: boolean) => void,
  containsChild: (target: Node) => boolean, closeChild: () => boolean, track = true
): (restoreFocus?: boolean) => void {
  mountPortal(panel, anchor, root);
  const position = () => positionAnchoredPortal(panel, anchor, 4, true);
  const stop = track ? trackAnchoredPortal(panel, anchor, position, close) : position();
  const pointer = (event: MouseEvent) => {
    const target = event.target as Node;
    if (!anchor.contains(target) && !panel.contains(target) && !containsChild(target)) close();
  };
  const keydown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (!closeChild()) close(true);
  };
  anchor.setAttribute("aria-expanded", "true");
  bindDismissListeners(true, pointer, keydown);
  return (restoreFocus) => {
    stop?.();
    bindDismissListeners(false, pointer, keydown);
    anchor.setAttribute("aria-expanded", "false");
    panel.remove();
    if (restoreFocus) (anchor.isConnected ? anchor : root).focus({ preventScroll: true });
  };
}
