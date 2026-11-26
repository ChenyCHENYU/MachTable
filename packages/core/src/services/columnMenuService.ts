import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import { el, textButton } from "../lib/dom";
import { openAnchoredDialog } from "../lib/anchoredDialog";
import type { MachTableLocaleKey } from "../lib/locale";
import { createSelectControl, type SelectControl } from "../lib/selectControl";

type ColumnMenuContext = Pick<
  GridCore<any>,
  "columnModel" | "api" | "getLocaleText" | "gridOptions" | "skeleton"
>;

/** @internal The column menu service stays behind the column facade. */
export class ColumnMenuService {
  private panel: HTMLElement | null = null;
  private anchor: HTMLElement | null = null;
  private detachPopup?: (restoreFocus?: boolean) => void;
  private standaloneAnchor: HTMLElement | null = null;
  private searchText = "";
  private selectControls = new Set<SelectControl>();

  constructor(private core: ColumnMenuContext) {}

  toggle(column: Column, anchor: HTMLElement): void {
    const wasOpen = this.anchor === anchor;
    this.close();
    if (!wasOpen) this.open(column, anchor);
  }

  openStandalone(anchor?: HTMLElement): void {
    this.close();
    const target =
      anchor ??
      (() => {
        const root = this.core.skeleton.root;
        const rect = root.getBoundingClientRect();
        const fake = el("div");
        fake.style.position = "fixed";
        fake.style.left = `${rect.right - 16}px`;
        fake.style.top = `${rect.top + this.core.gridOptions.headerHeight}px`;
        fake.style.width = "1px";
        fake.style.height = "1px";
        document.body.appendChild(fake);
        this.standaloneAnchor = fake;
        return fake;
      })();
    this.open(null, target);
  }

  close(restoreFocus = false): void {
    this.destroySelectControls();
    this.standaloneAnchor?.remove();
    this.standaloneAnchor = this.panel = this.anchor = null;
    const detach = this.detachPopup;
    this.detachPopup = undefined;
    detach?.(restoreFocus);
  }

  destroy(): void {
    this.close();
  }

  private open(column: Column | null, anchor: HTMLElement): void {
    const api = this.core.api;
    const panel = el("div", "mach-filter-panel mach-column-panel");
    if (!column) panel.classList.add("mach-column-workbench");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", column ? anchor.title : this.core.getLocaleText("columnSettings"));

    const title = el("div", "mach-column-panel-title");
    title.textContent = column
      ? column.colDef.headerName ?? column.colDef.field ?? column.id
      : this.core.getLocaleText("columnSettings");
    panel.appendChild(title);

    const action = (label: MachTableLocaleKey, run: () => void, className = "mach-column-panel-btn") =>
      textButton(className, this.core.getLocaleText(label), () => {
        run();
        if (this.panel === panel) this.close(true);
      });
    if (column) {
      const colId = column.id;
      const appendActions = (...buttons: HTMLButtonElement[]) => {
        const row = el("div", "mach-column-panel-actions");
        row.append(...buttons);
        panel.appendChild(row);
      };
      if (column.sortable) {
        appendActions(
          action("sortAsc", () => api.sorting.setModel([{ colId, direction: "asc" }])),
          action("sortDesc", () => api.sorting.setModel([{ colId, direction: "desc" }])),
          action("clearSort", () => api.sorting.setModel([]))
        );
      }
      appendActions(
        action("pinLeft", () => api.columns.setPinned(colId, "left")),
        action("pinRight", () => api.columns.setPinned(colId, "right")),
        action("clearPin", () => api.columns.setPinned(colId, null))
      );
      appendActions(
        action("autoSize", () => api.columns.autoSize(colId)),
        action("hideColumn", () => api.columns.setVisible(colId, false))
      );
    }

    const divider = el("div", "mach-column-panel-divider");
    panel.appendChild(divider);

    const listTitle = el("div", "mach-column-panel-subtitle");
    listTitle.textContent = this.core.getLocaleText("columnVisibility");
    panel.appendChild(listTitle);

    if (!column) {
      const search = el("input", "mach-column-workbench-search");
      search.type = "search";
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
    footer.append(
      action("resetAll", () => api.columns.resetState(), "mach-filter-btn-reset"),
      action("autoSizeAll", () => api.columns.autoSizeAll(), "mach-filter-btn-apply")
    );
    panel.appendChild(footer);

    this.panel = panel;
    this.anchor = anchor;
    this.detachPopup = openAnchoredDialog(panel, anchor, this.core.skeleton.root,
      (focus) => this.close(focus), (target) => this.containsSelectTarget(target), () => this.closeOpenSelect(),
      anchor !== this.standaloneAnchor);
    panel.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true });
  }

  private rebuildListStates(): void {
    if (!this.panel) return;
    const list = this.panel.querySelector<HTMLElement>(".mach-column-panel-list");
    if (list) this.renderColumnList(list, this.panel.classList.contains("mach-column-workbench"));
  }

  private renderColumnList(list: HTMLElement, workbench: boolean): void {
    const api = this.core.api;
    this.destroySelectControls(list);
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
      const checkbox = el("input");
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
        const pin = createSelectControl({
          ariaLabel: `${text.textContent} ${this.core.getLocaleText("clearPin")}`,
          options: [
            { value: "", label: this.core.getLocaleText("clearPin") },
            { value: "left", label: this.core.getLocaleText("pinLeft") },
            { value: "right", label: this.core.getLocaleText("pinRight") }
          ],
          value: col.pinned ?? "",
          classNames: {
            root: "mach-column-workbench-pin-control",
            native: "mach-column-workbench-pin"
          },
          themeSource: this.core.skeleton.root,
          onChange: (value) => {
            api.columns.setPinned(col.id, value === "left" || value === "right" ? value : null);
            this.rebuildListStates();
          }
        });
        pin.trigger.disabled = !col.movable;
        pin.native.disabled = !col.movable;
        this.selectControls.add(pin);
        row.appendChild(pin.el);

        const siblings = this.core.columnModel.getColumns().filter((candidate) =>
          !candidate.hide &&
          candidate.parentGroup === col.parentGroup &&
          (col.parentGroup != null || candidate.pinned === col.pinned)
        );
        const position = siblings.indexOf(col);
        const move = (caption: string, next: number, disabled: boolean) => {
          const button = textButton("mach-column-workbench-move", caption, () => {
            api.columns.move(col.id, next);
            this.rebuildListStates();
          });
          button.disabled = disabled || col.hide || !col.movable;
          return button;
        };
        row.append(move("↑", position - 1, position <= 0), move("↓", position + 1, position < 0 || position >= siblings.length - 1));
      }
      list.appendChild(row);
    }
  }

  private containsSelectTarget(target: Node): boolean {
    for (const control of this.selectControls) if (control.contains(target)) return true;
    return false;
  }

  private closeOpenSelect(): boolean {
    for (const control of this.selectControls) if (control.close(true)) return true;
    return false;
  }

  private destroySelectControls(container?: HTMLElement): void {
    for (const control of this.selectControls) {
      if (container && !container.contains(control.el)) continue;
      control.destroy();
      this.selectControls.delete(control);
    }
  }
}
