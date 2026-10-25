import type { GridApi } from "../types/api";
import { applyPortalTheme } from "../lib/dom";

export interface WorkbenchHandle {
  refresh(): void;
  destroy(): void;
}

export interface WorkbenchOptions<TData = any> {
  api: GridApi<TData>;
  onClose?: () => void;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K, className?: string, text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

export function button(label: string, onClick: () => void, className = ""): HTMLButtonElement {
  const node = element("button", `mach-workbench__button ${className}`.trim(), label);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

export function select(
  label: string, choices: readonly { value: string; label: string }[], value: string,
  onChange: (value: string) => void
): HTMLSelectElement {
  const node = element("select", "mach-workbench__input");
  node.setAttribute("aria-label", label);
  for (const choice of choices) {
    const option = element("option", undefined, choice.label);
    option.value = choice.value;
    node.append(option);
  }
  node.value = value;
  node.addEventListener("change", () => onChange(node.value));
  return node;
}

/** Rebuilt controls keep keyboard position; if an edge button is disabled, use its next peer. */
export function focusControl(host: HTMLElement, label: string): void {
  const controls = [...host.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLInputElement>("button,select,input")]
    .filter((control) => !control.disabled);
  const target = controls.find((control) => control.getAttribute("aria-label") === label || control.textContent === label) ?? controls[0];
  target?.focus();
}

/** Inline region, not a modal: native keyboard navigation works and teardown restores the previous focus. */
export function createWorkbench(host: HTMLElement, title: string, close: () => void, api: GridApi) {
  const previousFocus = document.activeElement as HTMLElement | null;
  const root = element("section", "mach-workbench");
  root.setAttribute("aria-label", title);
  root.tabIndex = -1;
  const header = element("header", "mach-workbench__header");
  header.append(element("h2", "mach-workbench__title", title), button("关闭", close));
  const body = element("div", "mach-workbench__body");
  const status = element("p", "mach-workbench__status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const footer = element("footer", "mach-workbench__footer");
  root.append(header, body, status, footer);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  root.addEventListener("keydown", onKeyDown);
  let destroyed = false;
  const source = api.view.getRoot();
  const syncTheme = () => {
    if (destroyed) return;
    root.dataset.theme = source?.classList.contains("mach-theme-dark") ? "dark" : "light";
    applyPortalTheme(root, source);
  };
  let observer: MutationObserver | null = null;
  try {
    syncTheme();
    if (source) {
      // Observe Core's resolved result, including auto theme. Do not duplicate its
      // media-query subscription or let an external panel outlive its grid owner.
      observer = new MutationObserver(syncTheme);
      observer.observe(source, { attributes: true, attributeFilter: ["class", "style"] });
    }
    host.append(root);
  } catch (error) { observer?.disconnect(); root.remove(); throw error; }
  return {
    root, body, status, footer, syncTheme,
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      observer?.disconnect();
      const restore = root.contains(document.activeElement);
      root.removeEventListener("keydown", onKeyDown);
      root.remove();
      if (restore && previousFocus?.isConnected) previousFocus.focus();
    }
  };
}

/** Error objects can be supplied by business callbacks, including throwing coercions. */
export function errorText(error: unknown): string {
  try { return error instanceof Error ? error.message : String(error); }
  catch { return "无法读取异常信息"; }
}
