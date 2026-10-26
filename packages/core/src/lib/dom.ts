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

/** Keeps body-mounted overlays visually scoped to their owning grid instance. */
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

/** Place a measured body portal below its anchor, flipping above when space runs out. */
export function positionAnchoredPortal(panel: HTMLElement, anchor: Element, gap = 4): void {
  const rect = anchor.getBoundingClientRect();
  const size = panel.getBoundingClientRect();
  const below = rect.bottom + gap;
  const top = below + size.height > window.innerHeight - 8 ? rect.top - size.height - gap : below;
  panel.style.left = `${clamp(rect.left, 8, Math.max(8, window.innerWidth - size.width - 8))}px`;
  panel.style.top = `${clamp(top, 8, Math.max(8, window.innerHeight - size.height - 8))}px`;
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
