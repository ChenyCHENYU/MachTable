import type { GridCore } from "../core/gridCore";
import type { PaneType } from "../services/columnModel";
import type { RowNode } from "../types/row";
import { el } from "../lib/dom";
import { renderCellContent, cleanupCellContent, applyCellClasses, applyCellStyle } from "./cellContent";

type PinnedRowsContext = Pick<
  GridCore<any>,
  | "columnModel"
  | "getApi"
  | "getCellValue"
  | "isDestroyed"
  | "options"
  | "relayout"
  | "reportError"
  | "resolveCellRenderer"
  | "skeleton"
>;

const PANES: PaneType[] = ["left", "center", "right"];

interface SideState {
  root: HTMLElement;
  segments: Record<PaneType, HTMLElement>;
  centerViewport: HTMLElement;
  rowWrappers: Record<PaneType, HTMLElement[]>;
  cells: Record<PaneType, HTMLElement[]>[];
  data: any[];
}

export class PinnedRowsRenderer {
  private top: SideState | null = null;
  private bottom: SideState | null = null;

  constructor(private core: PinnedRowsContext) {}

  init(): void {
    this.top = this.createSide(this.core.skeleton.pinnedTopEl);
    this.bottom = this.createSide(this.core.skeleton.pinnedBottomEl);
  }

  private createSide(root: HTMLElement): SideState {
    const state: SideState = {
      root,
      segments: { left: el("div"), center: el("div"), right: el("div") } as Record<PaneType, HTMLElement>,
      centerViewport: el("div", "mach-pinned-viewport"),
      rowWrappers: { left: [], center: [], right: [] } as Record<PaneType, HTMLElement[]>,
      cells: [],
      data: []
    };
    for (const pane of PANES) {
      state.segments[pane].className = `mach-pinned-seg mach-pinned-seg--${pane}`;
      if (pane !== "center") state.segments[pane].classList.add("mach-pane--hidden");
      if (pane === "center") {
        state.centerViewport.appendChild(state.segments[pane]);
      }
    }
    root.append(state.segments.left, state.centerViewport, state.segments.right);
    return state;
  }

  setData(top: any[] | null, bottom: any[] | null): void {
    if (this.core.isDestroyed() || !this.top || !this.bottom) return;
    this.top.data = top ?? [];
    this.bottom.data = bottom ?? [];
    this.rebuild();
    this.applyLayout();
    this.core.relayout();
  }

  setTopData(rows: any[] | null): void {
    if (this.core.isDestroyed() || !this.top) return;
    this.top.data = rows ?? [];
    this.rebuildSide(this.top, "top");
    this.applyLayout();
    this.core.relayout();
  }

  setBottomData(rows: any[] | null): void {
    if (this.core.isDestroyed() || !this.bottom) return;
    this.bottom.data = rows ?? [];
    this.rebuildSide(this.bottom, "bottom");
    this.applyLayout();
    this.core.relayout();
  }

  getTopData(): any[] {
    return this.top ? this.top.data.slice() : [];
  }

  getBottomData(): any[] {
    return this.bottom ? this.bottom.data.slice() : [];
  }

  rebuild(): void {
    if (!this.top || !this.bottom) return;
    this.rebuildSide(this.top, "top");
    this.rebuildSide(this.bottom, "bottom");
  }

  private rebuildSide(side: SideState, sideName: "top" | "bottom"): void {
    for (const row of side.cells) {
      for (const pane of PANES) {
        for (const cell of row[pane]) cleanupCellContent(this.core, cell);
      }
    }
    for (const pane of PANES) {
      for (const wrapper of side.rowWrappers[pane]) wrapper.remove();
      side.rowWrappers[pane] = [];
    }
    side.cells = [];
    side.root.style.display = side.data.length > 0 ? "" : "none";
    if (side.data.length === 0) return;

    const rowHeight = this.core.options.rowHeight;
    const cm = this.core.columnModel;

    side.data.forEach((data, i) => {
      const node: RowNode<any> = {
        id: `__pinned_${sideName}_${i}`,
        data,
        rowIndex: -1,
        selected: false
      };
      const cellsByPane = {} as Record<PaneType, HTMLElement[]>;
      for (const pane of PANES) {
        const wrapper = el("div", "mach-pinned-row");
        wrapper.style.height = `${rowHeight}px`;
        wrapper.setAttribute("role", "row");
        cellsByPane[pane] = [];
        for (const col of cm.getPaneColumns(pane)) {
          const cell = el("div", "mach-cell");
          cell.dataset.colId = col.id;
          cell.setAttribute("role", "gridcell");
          if (col.hasCheckbox) cell.classList.add("mach-cell--selection");
          if (!col.hasCheckbox && !col.isDetailToggle && !col.colDef.rowDrag && col.colDef.type !== "index") {
            try {
              renderCellContent(this.core, cell, node, col);
              applyCellClasses(this.core, cell, node, col);
              applyCellStyle(this.core, cell, node, col);
            } catch (err) {
              this.core.reportError(err, "pinnedRow.render", { colId: col.id, side: sideName, rowIndex: i });
            }
          }
          wrapper.appendChild(cell);
          cellsByPane[pane].push(cell);
        }
        side.segments[pane].appendChild(wrapper);
        side.rowWrappers[pane].push(wrapper);
      }
      side.cells.push(cellsByPane);
    });
  }

  applyLayout(): void {
    if (!this.top || !this.bottom) return;
    const cm = this.core.columnModel;
    const widths: Record<PaneType, number> = { left: 0, center: 0, right: 0 };
    const lefts: Record<PaneType, number[]> = { left: [], center: [], right: [] };
    for (const pane of PANES) {
      let x = 0;
      for (const col of cm.getPaneColumns(pane)) {
        lefts[pane].push(x);
        x += col.currentWidth;
      }
      widths[pane] = x;
    }

    for (const side of [this.top, this.bottom]) {
      const hidden = side.data.length === 0;
      side.segments.left.classList.toggle("mach-pane--hidden", hidden || widths.left <= 0);
      side.segments.right.classList.toggle("mach-pane--hidden", hidden || widths.right <= 0);
      side.segments.left.style.width = `${widths.left}px`;
      side.segments.right.style.width = `${widths.right}px`;
      side.segments.center.style.width = `${widths.center}px`;
      side.cells.forEach((cellsByPane) => {
        let globalColOffset = 0;
        for (const pane of PANES) {
          const cols = cm.getPaneColumns(pane);
          cellsByPane[pane].forEach((cell, i) => {
            cell.style.width = `${cols[i].currentWidth}px`;
            cell.style.left = `${lefts[pane][i]}px`;
            cell.setAttribute("aria-colindex", String(globalColOffset + i + 1));
          });
          globalColOffset += cols.length;
        }
      });
    }
  }

  onScrollLeft(scrollLeft: number): void {
    if (this.top) this.top.segments.center.style.transform = `translateX(${-scrollLeft}px)`;
    if (this.bottom) this.bottom.segments.center.style.transform = `translateX(${-scrollLeft}px)`;
  }

  refresh(): void {
    this.rebuild();
    this.applyLayout();
  }

  destroy(): void {
    for (const side of [this.top, this.bottom]) {
      if (!side) continue;
      for (const row of side.cells) {
        for (const pane of PANES) {
          for (const cell of row[pane]) cleanupCellContent(this.core, cell);
        }
      }
    }
    this.top = null;
    this.bottom = null;
  }
}
