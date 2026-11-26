export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  attrs?: Record<string, string>
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      e.setAttribute(key, attrs[key]);
    }
  }
  return e;
}

export function setStyles(e: HTMLElement, styles: Partial<CSSStyleDeclaration>): void {
  Object.assign(e.style, styles);
}

export function textButton(className: string, label: string, action: () => void): HTMLButtonElement {
  const button = el("button", className);
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", action);
  return button;
}

/** Keep the same handler identities and capture mode at both ends of an interaction. */
export function bindListeners(
  target: EventTarget,
  active: boolean,
  handlers: Record<string, (event: never) => void>,
  capture = false
): void {
  const method = active ? "addEventListener" : "removeEventListener";
  for (const [event, handler] of Object.entries(handlers)) target[method](event, handler as EventListener, capture);
}

export function bindDismissListeners(active: boolean, mouseDown: (event: MouseEvent) => void, keyDown: (event: KeyboardEvent) => void): void {
  bindListeners(document, active, { mousedown: mouseDown, keydown: keyDown }, true);
}

/** Keeps portalled overlays visually scoped to their owning grid instance. */
export function applyPortalTheme(portal: HTMLElement, source: HTMLElement | null): void {
  portal.classList.add("mach-portal");
  if (!source) return;
  const styles = window.getComputedStyle(source);
  for (let index = 0; index < styles.length; index++) {
    const property = styles.item(index);
    if (!property.startsWith("--mach-")) continue;
    const value = styles.getPropertyValue(property).trim();
    if (value) portal.style.setProperty(property, value);
  }
  portal.style.colorScheme = styles.colorScheme;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Keep interactive overlays in the modal's stacking and focus scope. */
export function mountPortal(panel: HTMLElement, anchor: Element, source: HTMLElement | null): void {
  applyPortalTheme(panel, source);
  const modal = '[aria-modal="true"],dialog[open]';
  (anchor.closest(modal) ?? source?.closest(modal) ?? document.body).appendChild(panel);
}

/** Measure from the fixed containing block's origin, which can be inside a transformed modal. */
export function positionAnchoredPortal(panel: HTMLElement, anchor: Element, gap = 4, fit = false): void {
  const style = panel.style;
  style.left = style.top = "0px";
  if (fit) style.maxHeight = "";
  const rect = anchor.getBoundingClientRect();
  const size = panel.getBoundingClientRect();
  const below = window.innerHeight - rect.bottom - gap - 8;
  const above = rect.top - gap - 8;
  const flip = size.height > below && above > below;
  const available = Math.max(0, flip ? above : below);
  const scaleY = panel.offsetHeight / size.height || 1;
  const height = fit ? Math.min(size.height, available) : size.height;
  if (height < size.height) style.maxHeight = `${height * scaleY}px`;
  const top = flip ? rect.top - height - gap : rect.bottom + gap;
  const left = clamp(rect.left, 8, Math.max(8, window.innerWidth - size.width - 8));
  style.left = `${(left - size.left) * (panel.offsetWidth / size.width || 1)}px`;
  style.top = `${(clamp(top, 8, Math.max(8, window.innerHeight - height - 8)) - size.top) * scaleY}px`;
}

let uidCounter = 0;

export function nextUid(prefix = "rg"): string {
  uidCounter++;
  return `${prefix}-${uidCounter}`;
}

export function toPx(n: number): string {
  return `${n}px`;
}

export const FILTER_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5h12L9.5 8v4.5L6.5 14V8L2 3.5z"/></svg>';

export const SORT_ASC_ICON =
  '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M8 3l4 5H4l4-5z"/></svg>';

export const SORT_DESC_ICON =
  '<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M8 13l4-5H4l4 5z"/></svg>';

export const COLUMN_TOOLS_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"><path d="M2 4h3m3 0h6M2 8h7m3 0h2M2 12h1m3 0h8"/><circle cx="6.5" cy="4" r="1.35"/><circle cx="10.5" cy="8" r="1.35"/><circle cx="4.5" cy="12" r="1.35"/></svg>';
