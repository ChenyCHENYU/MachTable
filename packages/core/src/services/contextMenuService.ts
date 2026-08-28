import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
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

  open(x: number, y: number, anchor?: { rowIndex: number; colId: string }): void {
    this.close();
    const core = this.core;
    let node: import("../types/row").RowNode<any> | undefined;
    let anchorCol: Column | undefined;

    if (anchor) {
      node = core.rowModel.getDisplayedRow(anchor.rowIndex);
      anchorCol = core.columnModel.getColumn(anchor.colId);
    } else {
      const range = core.bodyRenderer.getNormalizedRangeOrFocus();
      if (!range) return;
      const flat = core.columnModel.getOrderedVisible();
      node = core.rowModel.getDisplayedRow(range.r1);
      anchorCol = flat[range.c1];
    }
    if (!node || !anchorCol) return;
    const anchorIndex = node.rowIndex;

    const panel = el("div", "mach-context-menu");
    panel.setAttribute("role", "menu");

    const customGetter = core.options.getContextMenuItems;
    if (customGetter) {
      let items;
      try {
        items = customGetter({
          data: node.data,
          node,
          api: core.getApi(),
          colId: anchorCol.id,
          value: core.getCellValue(node, anchorCol),
          rowIndex: anchorIndex
        });
      } catch (error) {
        core.reportError(error, "getContextMenuItems", { colId: anchorCol.id, rowId: node.id });
        return;
      }
      if (items === null || items === undefined) return;
      let hasEnabled = false;
      for (const item of items) {
        if (item.separator) {
          const sep = el("div", "mach-context-menu-separator");
          panel.appendChild(sep);
          continue;
        }
        const btn = el("button", "mach-context-menu-item") as HTMLButtonElement;
        btn.type = "button";
        btn.textContent = item.label ?? "";
        if (item.danger) btn.classList.add("mach-context-menu-item--danger");
        if (item.disabled) {
          btn.disabled = true;
        } else {
          hasEnabled = true;
          btn.addEventListener("click", () => {
            this.close();
            try {
              item.action?.();
            } catch (error) {
              core.reportError(error, "contextMenu.action", { colId: anchorCol!.id, rowId: node!.id });
            }
          });
        }
        panel.appendChild(btn);
      }
      if (!hasEnabled) {
        panel.remove();
        return;
      }
      this.attach(panel, x, y);
      return;
    }

    const copyBtn = el("button", "mach-context-menu-item") as HTMLButtonElement;
    copyBtn.type = "button";
    copyBtn.textContent = core.getLocaleText("menuCopy");
    copyBtn.addEventListener("click", () => {
      void core.copyActiveRange();
      this.close();
    });
    panel.appendChild(copyBtn);

    if (!core.options.suppressClipboard) {
      const pasteBtn = el("button", "mach-context-menu-item") as HTMLButtonElement;
      pasteBtn.type = "button";
      pasteBtn.textContent = core.getLocaleText("menuPaste");
      pasteBtn.addEventListener("click", () => {
        void core.pasteFromSystemClipboard();
        this.close();
      });
      panel.appendChild(pasteBtn);

      const clearBtn = el("button", "mach-context-menu-item") as HTMLButtonElement;
      clearBtn.type = "button";
      clearBtn.textContent = core.getLocaleText("menuClearContents");
      clearBtn.addEventListener("click", () => {
        const active = core.bodyRenderer.getNormalizedRangeOrFocus();
        if (active) core.clearRangeValues(active);
        this.close();
      });
      panel.appendChild(clearBtn);
    }

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
