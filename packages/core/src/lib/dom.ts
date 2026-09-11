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

const PORTAL_THEME_PROPERTIES = [
  "--mach-font-family",
  "--mach-font-size",
  "--mach-font-size-sm",
  "--mach-header-font-weight",
  "--mach-cell-padding",
  "--mach-header-h",
  "--mach-primary",
  "--mach-primary-weak",
  "--mach-success",
  "--mach-warning",
  "--mach-danger",
  "--mach-info",
  "--mach-border-color",
  "--mach-header-fg",
  "--mach-body-bg",
  "--mach-body-fg",
  "--mach-row-hover-bg",
  "--mach-radius-sm",
  "--mach-radius",
  "--mach-radius-lg",
  "--mach-shadow-sm",
  "--mach-shadow",
  "--mach-transition",
  "--mach-z-popup",
  "--mach-z-menu"
] as const;

/** Keeps body-mounted overlays visually scoped to their owning grid instance. */
export function applyPortalTheme(portal: HTMLElement, source: HTMLElement | null): void {
  portal.classList.add("mach-portal");
  if (!source) return;
  const styles = window.getComputedStyle(source);
  for (const property of PORTAL_THEME_PROPERTIES) {
    const value = styles.getPropertyValue(property).trim();
    if (value) portal.style.setProperty(property, value);
  }
  portal.style.colorScheme = styles.colorScheme;
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
