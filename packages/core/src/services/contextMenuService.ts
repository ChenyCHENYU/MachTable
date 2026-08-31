import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type { ContextMenuItem } from "../types/params";
import type { RowNode } from "../types/row";
import { el, clamp } from "../lib/dom";

type ContextMenuContext = Pick<
  GridCore<any>,
  | "bodyRenderer"
  | "clearRangeValues"
  | "columnModel"
  | "copyActiveRange"
  | "getApi"
  | "getCellValue"
  | "getLocaleText"
  | "options"
  | "pasteFromSystemClipboard"
  | "reportError"
  | "rowModel"
>;

export class ContextMenuService {
  private panel: HTMLElement | null = null;

  constructor(private core: ContextMenuContext) {}

  private resolveAnchor(anchor?: { rowIndex: number; colId: string }): { node: RowNode<any>; column: Column } | null {
    if (anchor) {
      const node = this.core.rowModel.getDisplayedRow(anchor.rowIndex);
      const column = this.core.columnModel.getColumn(anchor.colId);
      return node && column ? { node, column } : null;
    }
    const range = this.core.bodyRenderer.getNormalizedRangeOrFocus();
    if (!range) return null;
    const node = this.core.rowModel.getDisplayedRow(range.r1);
    const column = this.core.columnModel.getOrderedVisible()[range.c1];
    return node && column ? { node, column } : null;
  }

  private readCustomItems(node: RowNode<any>, column: Column): readonly ContextMenuItem[] | null {
    const getter = this.core.options.getContextMenuItems;
    if (!getter) return null;
    try {
      return getter({
        data: node.data, node, api: this.core.getApi(), colId: column.id,
        value: this.core.getCellValue(node, column), rowIndex: node.rowIndex
      }) ?? null;
    } catch (error) {
      this.core.reportError(error, "getContextMenuItems", { colId: column.id, rowId: node.id });
      return null;
    }
  }

  private populateCustomPanel(
    panel: HTMLElement,
    items: readonly ContextMenuItem[],
    node: RowNode<any>,
    column: Column
  ): boolean {
    let hasEnabled = false;
    for (const item of items) {
      if (item.separator) {
        panel.appendChild(el("div", "mach-context-menu-separator"));
        continue;
      }
      const button = el("button", "mach-context-menu-item") as HTMLButtonElement;
      button.type = "button";
      button.textContent = item.label ?? "";
      if (item.danger) button.classList.add("mach-context-menu-item--danger");
      button.disabled = item.disabled === true;
      if (!button.disabled) {
        hasEnabled = true;
        button.addEventListener("click", () => this.runCustomItem(item, node, column));
      }
      panel.appendChild(button);
    }
    return hasEnabled;
  }

  private runCustomItem(item: ContextMenuItem, node: RowNode<any>, column: Column): void {
    this.close();
    try {
      item.action?.();
    } catch (error) {
      this.core.reportError(error, "contextMenu.action", { colId: column.id, rowId: node.id });
    }
  }

  private appendDefaultButton(panel: HTMLElement, label: string, action: () => void): void {
    const button = el("button", "mach-context-menu-item") as HTMLButtonElement;
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", action);
    panel.appendChild(button);
  }

  private populateDefaultPanel(panel: HTMLElement): void {
    const core = this.core;
    this.appendDefaultButton(panel, core.getLocaleText("menuCopy"), () => {
      void core.copyActiveRange();
      this.close();
    });
    if (core.options.suppressClipboard) return;
    this.appendDefaultButton(panel, core.getLocaleText("menuPaste"), () => {
      void core.pasteFromSystemClipboard();
      this.close();
    });
    this.appendDefaultButton(panel, core.getLocaleText("menuClearContents"), () => {
      const active = core.bodyRenderer.getNormalizedRangeOrFocus();
      if (active) core.clearRangeValues(active);
      this.close();
    });
  }

  open(x: number, y: number, anchor?: { rowIndex: number; colId: string }): void {
    this.close();
    const resolved = this.resolveAnchor(anchor);
    if (!resolved) return;
    const panel = el("div", "mach-context-menu");
    panel.setAttribute("role", "menu");
    if (this.core.options.getContextMenuItems) {
      const items = this.readCustomItems(resolved.node, resolved.column);
      if (!items || !this.populateCustomPanel(panel, items, resolved.node, resolved.column)) return;
      this.attach(panel, x, y);
      return;
    }
    this.populateDefaultPanel(panel);
    this.attach(panel, x, y);
  }

  private attach(panel: HTMLElement, x: number, y: number): void {
    document.body.appendChild(panel);
    this.panel = panel;
    const rect = panel.getBoundingClientRect();
    const left = clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8));
    const top = clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    document.addEventListener("mousedown", this.docMouseDown, true);
    document.addEventListener("keydown", this.docKeyDown, true);
  }

  close(): void {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    document.removeEventListener("mousedown", this.docMouseDown, true);
    document.removeEventListener("keydown", this.docKeyDown, true);
  }

  destroy(): void {
    this.close();
  }

  private docMouseDown = (e: MouseEvent): void => {
    if (this.panel && !this.panel.contains(e.target as Node)) this.close();
  };

  private docKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };
}
