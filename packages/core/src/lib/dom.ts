export function el(tag: string, className?: string, attrs?: Record<string, string>): HTMLElement {
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

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
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
  '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3.5h12L9.5 8v4.5L6.5 14V8L2 3.5z"/></svg>';

export const SORT_ASC_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 3l4 5H4l4-5z"/></svg>';

export const SORT_DESC_ICON =
  '<svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor"><path d="M8 13l4-5H4l4 5z"/></svg>';
