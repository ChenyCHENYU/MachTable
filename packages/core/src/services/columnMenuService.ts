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
  private searchText = "";

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
    panel.setAttribute("role", column ? "menu" : "dialog");
    if (!column) {
      panel.setAttribute("aria-modal", "false");
      panel.setAttribute("aria-label", this.core.getLocaleText("columnSettings"));
    }

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
          api.sorting.setModel(dir ? [{ colId: column.id, direction: dir }] : []);
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
        if (column) api.columns.setPinned(column.id, pinned);
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
      if (column) api.columns.autoSize(column.id);
      else api.columns.autoSizeAll();
      this.close();
    });
    const hideBtn = el("button", "mach-column-panel-btn") as HTMLButtonElement;
    hideBtn.type = "button";
    hideBtn.textContent = this.core.getLocaleText("hideColumn");
    hideBtn.addEventListener("click", () => {
      if (column) api.columns.setVisible(column.id, false);
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

    if (!column) {
      const search = document.createElement("input");
      search.type = "search";
      search.className = "mach-column-workbench-search";
      search.placeholder = this.core.getLocaleText("search");
      search.setAttribute("aria-label", this.core.getLocaleText("search"));
      search.value = this.searchText;
      search.addEventListener("input", () => {
        this.searchText = search.value.trim().toLocaleLowerCase();
        this.renderColumnList(list, true);
      });
      panel.appendChild(search);
    }

    const list = el("div", "mach-column-panel-list");
    this.renderColumnList(list, !column);
    panel.appendChild(list);

    const footer = el("div", "mach-filter-footer");
    const resetBtn = el("button", "mach-filter-btn-reset") as HTMLButtonElement;
    resetBtn.type = "button";
    resetBtn.textContent = this.core.getLocaleText("resetAll");
    resetBtn.addEventListener("click", () => {
      api.columns.resetState();
      this.close();
    });
    const allFitBtn = el("button", "mach-filter-btn-apply") as HTMLButtonElement;
    allFitBtn.type = "button";
    allFitBtn.textContent = this.core.getLocaleText("autoSizeAll");
    allFitBtn.addEventListener("click", () => {
      api.columns.autoSizeAll();
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
    const list = this.panel.querySelector<HTMLElement>(".mach-column-panel-list");
    if (list) this.renderColumnList(list, this.openColId === "__standalone__");
  }

  private renderColumnList(list: HTMLElement, workbench: boolean): void {
    const api = this.core.getApi();
    list.replaceChildren();
    const columns = this.core.columnModel.getColumns().filter((candidate) => {
      if (candidate.isDetailToggle) return false;
      if (!workbench || !this.searchText) return true;
      const label = candidate.colDef.headerName ?? candidate.colDef.field ?? candidate.id;
      return `${label} ${candidate.id}`.toLocaleLowerCase().includes(this.searchText);
    });
    for (const col of columns) {
      const row = el("div", workbench ? "mach-column-workbench-item" : "mach-filter-set-item");
      const label = el("label", "mach-column-workbench-label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = !col.hide;
      checkbox.disabled = col.hasCheckbox;
      checkbox.addEventListener("change", () => {
        api.columns.setVisible(col.id, checkbox.checked);
        this.rebuildListStates();
      });
      const text = el("span", "mach-column-workbench-name");
      text.textContent = col.colDef.headerName ?? col.colDef.field ?? col.id;
      text.title = `${text.textContent} (${col.id})`;
      label.append(checkbox, text);
      row.appendChild(label);

      if (workbench) {
        const pin = document.createElement("select");
        pin.className = "mach-column-workbench-pin";
        pin.setAttribute("aria-label", `${text.textContent} ${this.core.getLocaleText("clearPin")}`);
        for (const [value, caption] of [
          ["", this.core.getLocaleText("clearPin")],
          ["left", this.core.getLocaleText("pinLeft")],
          ["right", this.core.getLocaleText("pinRight")]
        ] as const) {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = caption;
          pin.appendChild(option);
        }
        pin.value = col.pinned ?? "";
        pin.addEventListener("change", () => {
          api.columns.setPinned(col.id, pin.value === "left" || pin.value === "right" ? pin.value : null);
          this.rebuildListStates();
        });
        row.appendChild(pin);

        const siblings = this.core.columnModel.getColumns().filter((candidate) =>
          !candidate.hide &&
          candidate.parentGroup === col.parentGroup &&
          (col.parentGroup != null || candidate.pinned === col.pinned)
        );
        const position = siblings.indexOf(col);
        const move = (caption: string, next: number, disabled: boolean) => {
          const button = el("button", "mach-column-workbench-move") as HTMLButtonElement;
          button.type = "button";
          button.textContent = caption;
          button.disabled = disabled || col.hide || !col.movable;
          button.addEventListener("click", () => {
            api.columns.move(col.id, next);
            this.rebuildListStates();
          });
          return button;
        };
        row.append(move("↑", position - 1, position <= 0), move("↓", position + 1, position < 0 || position >= siblings.length - 1));
      }
      list.appendChild(row);
    }
  }
}
