import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { el, clamp } from "../lib/dom";

type ColumnMenuContext = Pick<
  GridCore<any>,
  "columnModel" | "getApi" | "getLocaleText" | "options" | "skeleton"
>;

export class ColumnMenuService {
  private panel: HTMLElement | null = null;
  private openColId: string | null = null;
  private standaloneAnchor: HTMLElement | null = null;

  constructor(private core: ColumnMenuContext) {}

  toggle(column: Column, anchor: HTMLElement): void {
    if (this.openColId === column.id) {
      this.close();
      return;
    }
    this.close();
    this.open(column, anchor);
  }

  openStandalone(anchor?: HTMLElement): void {
    this.close();
    const target =
      anchor ??
      (() => {
        const root = this.core.skeleton.root;
        const rect = root.getBoundingClientRect();
        const fake = document.createElement("div");
        fake.style.position = "fixed";
        fake.style.left = `${rect.right - 16}px`;
        fake.style.top = `${rect.top + this.core.options.headerHeight}px`;
        fake.style.width = "1px";
        fake.style.height = "1px";
        document.body.appendChild(fake);
        this.standaloneAnchor = fake;
        return fake;
      })();
    this.open(null, target);
  }

  close(): void {
    if (this.standaloneAnchor) {
      this.standaloneAnchor.remove();
      this.standaloneAnchor = null;
    }
    this.panel?.remove();
    this.panel = null;
    this.openColId = null;
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

  private open(column: Column | null, anchor: HTMLElement): void {
    const api = this.core.getApi();
    const panel = el("div", "mach-filter-panel mach-column-panel");
    panel.setAttribute("role", "menu");

    const title = el("div", "mach-column-panel-title");
    title.textContent = column
      ? column.colDef.headerName ?? column.colDef.field ?? column.id
      : this.core.getLocaleText("columnSettings");
    panel.appendChild(title);

    if (column && column.sortable) {
      const sortRow = el("div", "mach-column-panel-actions");
      const makeSortBtn = (labelKey: "sortAsc" | "sortDesc" | "clearSort", dir: "asc" | "desc" | null) => {
        const btn = el("button", "mach-column-panel-btn") as HTMLButtonElement;
        btn.type = "button";
        btn.textContent = this.core.getLocaleText(labelKey);
        btn.addEventListener("click", () => {
          api.setSortModel(dir ? [{ colId: column.id, direction: dir }] : []);
          this.close();
        });
        return btn;
      };
      sortRow.append(makeSortBtn("sortAsc", "asc"), makeSortBtn("sortDesc", "desc"), makeSortBtn("clearSort", null));
      panel.appendChild(sortRow);
    }

    const pinRow = el("div", "mach-column-panel-actions");
    const makePinBtn = (labelKey: "pinLeft" | "pinRight" | "clearPin", pinned: "left" | "right" | null) => {
      const btn = el("button", "mach-column-panel-btn") as HTMLButtonElement;
      btn.type = "button";
      btn.textContent = this.core.getLocaleText(labelKey);
      btn.addEventListener("click", () => {
        if (column) api.setColumnPinned(column.id, pinned);
        this.close();
      });
      return btn;
    };
    if (column) {
      pinRow.append(makePinBtn("pinLeft", "left"), makePinBtn("pinRight", "right"), makePinBtn("clearPin", null));
      panel.appendChild(pinRow);
    }

    const toolRow = el("div", "mach-column-panel-actions");
    const fitBtn = el("button", "mach-column-panel-btn") as HTMLButtonElement;
    fitBtn.type = "button";
    fitBtn.textContent = this.core.getLocaleText("autoSize");
    fitBtn.addEventListener("click", () => {
      if (column) api.autoSizeColumn(column.id);
      else api.autoSizeAllColumns();
      this.close();
    });
    const hideBtn = el("button", "mach-column-panel-btn") as HTMLButtonElement;
    hideBtn.type = "button";
    hideBtn.textContent = this.core.getLocaleText("hideColumn");
    hideBtn.addEventListener("click", () => {
      if (column) api.setColumnVisibility(column.id, false);
      this.close();
    });
    if (column) {
      toolRow.append(fitBtn, hideBtn);
      panel.appendChild(toolRow);
    }

    const divider = el("div", "mach-column-panel-divider");
    panel.appendChild(divider);

    const listTitle = el("div", "mach-column-panel-subtitle");
    listTitle.textContent = this.core.getLocaleText("columnVisibility");
    panel.appendChild(listTitle);

    const list = el("div", "mach-column-panel-list");
    for (const col of this.core.columnModel.getColumns()) {
      if (col.isDetailToggle) continue;
      const label = el("label", "mach-filter-set-item");
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !col.hide;
      cb.disabled = col.hasCheckbox;
      cb.addEventListener("change", () => {
        api.setColumnVisibility(col.id, cb.checked);
        this.rebuildListStates();
      });
      const span = el("span");
      span.textContent = col.colDef.headerName ?? col.colDef.field ?? col.id;
      label.append(cb, span);
      list.appendChild(label);
    }
    panel.appendChild(list);

    const footer = el("div", "mach-filter-footer");
    const resetBtn = el("button", "mach-filter-btn-reset") as HTMLButtonElement;
    resetBtn.type = "button";
    resetBtn.textContent = this.core.getLocaleText("resetAll");
    resetBtn.addEventListener("click", () => {
      api.resetColumnState();
      this.close();
    });
    const allFitBtn = el("button", "mach-filter-btn-apply") as HTMLButtonElement;
    allFitBtn.type = "button";
    allFitBtn.textContent = this.core.getLocaleText("autoSizeAll");
    allFitBtn.addEventListener("click", () => {
      api.autoSizeAllColumns();
      this.close();
    });
    footer.append(resetBtn, allFitBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    this.panel = panel;
    this.openColId = column ? column.id : "__standalone__";

    const rect = anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const left = clamp(rect.left, 8, window.innerWidth - panelRect.width - 8);
    let top = rect.bottom + 4;
    if (top + panelRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - panelRect.height - 4);
    }
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;

    document.addEventListener("mousedown", this.docMouseDown, true);
    document.addEventListener("keydown", this.docKeyDown, true);
  }

  private rebuildListStates(): void {
    if (!this.panel) return;
    const items = this.panel.querySelectorAll<HTMLLabelElement>(".mach-column-panel-list .mach-filter-set-item");
    const cols = this.core.columnModel.getColumns().filter((c) => !c.isDetailToggle);
    items.forEach((item, i) => {
      const col = cols[i];
      if (!col) return;
      const cb = item.querySelector<HTMLInputElement>("input");
      if (cb && !cb.disabled) cb.checked = !col.hide;
    });
  }
}
