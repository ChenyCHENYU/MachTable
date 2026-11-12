import { FILTER_MATCHES } from "../lib/filterMatches";
import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type {
  ColumnFilter,
  DateFilterMatch,
  NumberFilterMatch,
  TextFilterMatch
} from "../types/colDef";
import { applyPortalTheme, bindDismissListeners, el, positionAnchoredPortal, textButton } from "../lib/dom";
import { matchLocaleKey } from "../lib/locale";
import { createSelectControl, type SelectControl } from "../lib/selectControl";

type FilterPopupContext = Pick<
  GridCore<any>,
  "applyColumnFilter" | "readCellValue" | "getLocaleText" | "rowModel" | "skeleton"
>;

type ConditionFilterType = "text" | "number" | "date";
type ConditionMatch = TextFilterMatch | NumberFilterMatch | DateFilterMatch;
type ReadFilter = () => ColumnFilter | null;

function isBlankMatch(match: string): boolean {
  return match === "blank" || match === "notBlank";
}
function setValueKey(value: string | number | null): string {
  if (value === null) return "null:";
  return `${typeof value}:${String(value)}`;
}

/** @internal Filter popup state stays with its owning grid. */
export class FilterPopupService {
  private panel: HTMLElement | null = null;
  private openColId: string | null = null;
  private conditionSelect: SelectControl | null = null;

  constructor(private core: FilterPopupContext) {}

  toggle(column: Column, anchor: HTMLElement): void {
    if (this.openColId === column.id) {
      this.close();
      return;
    }
    this.close();
    this.open(column, anchor);
  }

  private docMouseDown = (e: MouseEvent): void => {
    if (!this.panel) return;
    const target = e.target as Node;
    if (this.conditionSelect?.contains(target)) return;
    if (!this.panel.contains(target)) {
      this.close();
      return;
    }
    if (!(target instanceof Element) || !target.closest(".mach-filter-select-control")) {
      this.conditionSelect?.close();
    }
  };

  private docKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.conditionSelect?.close(true)) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    this.close();
  };

  private open(column: Column, anchor: HTMLElement): void {
    const filter = this.core.rowModel.getFilterModel()[column.id] ?? null;
    const type = filter?.type ?? column.filterType;
    const panel = el("div", "mach-filter-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${column.id} filter`);

    const apply = (next: ColumnFilter | null) => {
      this.core.applyColumnFilter(column, next);
      this.close();
    };
    const readFilter = type === "set"
      ? this.buildSetBody(panel, column, filter)
      : this.buildConditionBody(panel, type, filter, apply);

    const footer = el("div", "mach-filter-footer");
    footer.append(
      textButton("mach-filter-btn-reset", this.core.getLocaleText("reset"), () => apply(null)),
      textButton("mach-filter-btn-apply", this.core.getLocaleText("apply"), () => apply(readFilter()))
    );
    panel.appendChild(footer);

    applyPortalTheme(panel, this.core.skeleton.root);
    document.body.appendChild(panel);
    this.panel = panel;
    this.openColId = column.id;

    positionAnchoredPortal(panel, anchor);

    bindDismissListeners(true, this.docMouseDown, this.docKeyDown);
    const firstInput = panel.querySelector<HTMLElement>(".mach-filter-select-trigger, input");
    firstInput?.focus();
  }

  close(): void {
    if (!this.panel) return;
    this.conditionSelect?.destroy();
    this.conditionSelect = null;
    this.panel.remove();
    this.panel = null;
    this.openColId = null;
    bindDismissListeners(false, this.docMouseDown, this.docKeyDown);
  }

  destroy(): void {
    this.close();
  }

  private buildConditionBody(
    panel: HTMLElement,
    type: ConditionFilterType,
    filter: ColumnFilter | null,
    apply: (filter: ColumnFilter | null) => void
  ): ReadFilter {
    const existing =
      filter && filter.type !== "set" && filter.conditions.length > 0 ? filter.conditions[0] : null;
    const currentMatch: ConditionMatch =
      existing?.match ?? (type === "text" ? "contains" : "equals");
    const { el: selectControl, native: select } = this.createConditionSelect(type, currentMatch);
    const valueInput = this.createConditionInput(type);
    const value2Input = this.createConditionInput(type, true);
    this.populateConditionInputs(type, currentMatch, existing, valueInput, value2Input);
    this.updateConditionInputVisibility(currentMatch, valueInput, value2Input);
    select.addEventListener("change", () => {
      this.updateConditionInputVisibility(select.value, valueInput, value2Input);
    });

    const body = el("div", "mach-filter-body");
    body.append(selectControl, valueInput, value2Input);
    panel.appendChild(body);
    const readFilter = () => this.readConditionFilter(type, select.value, valueInput.value, value2Input.value);
    const applyOnEnter = (event: KeyboardEvent) => {
      if (event.key === "Enter") apply(readFilter());
    };
    valueInput.addEventListener("keydown", applyOnEnter);
    value2Input.addEventListener("keydown", applyOnEnter);
    return readFilter;
  }

  private createConditionSelect(type: ConditionFilterType, current: ConditionMatch): SelectControl {
    const control = createSelectControl({
      ariaLabel: "Filter condition",
      options: FILTER_MATCHES[type].map((match) => ({
        value: match,
        label: this.core.getLocaleText(matchLocaleKey(match))
      })),
      value: current,
      classNames: {
        root: "mach-filter-select-control",
        native: "mach-filter-select",
        trigger: "mach-filter-select-trigger",
        value: "mach-filter-select-value",
        caret: "mach-filter-select-caret",
        listbox: "mach-filter-listbox",
        option: "mach-filter-listbox-option"
      },
      themeSource: this.core.skeleton.root
    });
    this.conditionSelect = control;
    return control;
  }

  private createConditionInput(type: ConditionFilterType, second = false): HTMLInputElement {
    const className = `mach-filter-input${second ? " mach-filter-input--second" : ""}`;
    const input = el("input", className);
    input.type = type;
    return input;
  }

  private populateConditionInputs(
    type: ConditionFilterType,
    match: ConditionMatch,
    existing: Exclude<ColumnFilter, { type: "set" }>["conditions"][number] | null,
    valueInput: HTMLInputElement,
    value2Input: HTMLInputElement
  ): void {
    if (existing?.value != null && !isBlankMatch(match)) {
      valueInput.value = type === "date" ? String(existing.value).slice(0, 10) : String(existing.value);
    }
    if (existing && "value2" in existing && existing.value2 != null) {
      value2Input.value = type === "date" ? String(existing.value2).slice(0, 10) : String(existing.value2);
    }
  }

  private updateConditionInputVisibility(
    match: string,
    valueInput: HTMLInputElement,
    value2Input: HTMLInputElement
  ): void {
    valueInput.style.display = isBlankMatch(match) ? "none" : "";
    value2Input.style.display = match === "inRange" ? "" : "none";
  }

  private buildSetBody(panel: HTMLElement, column: Column, filter: ColumnFilter | null): ReadFilter {
    const def = column.colDef;
    const params = def.filterParams;
    let values: (string | number | null)[];

    if (params?.values) {
      values = params.values;
    } else {
      const seen = new Set<string>();
      values = [];
      const nodes = this.core.rowModel.getAllNodes();
      const cap = Math.min(nodes.length, params?.maxValues ?? 500);
      for (let i = 0; i < cap; i++) {
        const v = this.core.readCellValue(nodes[i], column);
        const key = setValueKey(v == null ? null : v);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(v);
      }
    }

    const selected = new Set<string>(
      (filter?.type === "set" ? filter.values : values).map(setValueKey)
    );

    const search = el("input", "mach-filter-input mach-filter-input--search");
    search.type = "text";
    search.placeholder = this.core.getLocaleText("search");

    const list = el("div", "mach-filter-set-list");
    const valueByKey = new Map(values.map((value) => [setValueKey(value), value ?? null]));

    const renderList = (query: string) => {
      list.textContent = "";
      const q = query.trim().toLowerCase();
      for (const v of values) {
        const text = v == null ? this.core.getLocaleText("emptySetLabel") : String(v);
        if (q && !text.toLowerCase().includes(q)) continue;
        const key = setValueKey(v);
        const label = el("label", "mach-filter-set-item");
        const cb = el("input");
        cb.type = "checkbox";
        cb.checked = selected.has(key);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(key);
          else selected.delete(key);
        });
        const span = el("span");
        span.textContent = text;
        label.append(cb, span);
        list.appendChild(label);
      }
    };

    search.addEventListener("input", () => renderList(search.value));
    renderList("");

    const body = el("div", "mach-filter-body mach-filter-body--set");
    body.append(search, list);
    panel.appendChild(body);
    // Selection belongs to the popup, including values hidden by the search.
    return () => {
      const picked = [];
      for (const [key, value] of valueByKey) if (selected.has(key)) picked.push(value);
      return picked.length && picked.length < valueByKey.size ? { type: "set", values: picked } : null;
    };
  }

  private readConditionFilter(type: ConditionFilterType, match: string, raw: string, end: string): ColumnFilter | null {
    if (isBlankMatch(match)) {
      return { type, conditions: [{ match }] } as ColumnFilter;
    }
    if (raw === "" && match !== "inRange") return null;
    const number = type === "number";
    const value = number ? Number(raw) : raw;
    if (Number.isNaN(value)) return null;
    if (type === "text" || match !== "inRange") {
      return { type, conditions: [{ match, value }] } as ColumnFilter;
    }
    const value2 = end ? (number ? Number(end) : end) : value;
    if (Number.isNaN(value2)) return null;
    return { type, conditions: [{ match, value, value2 }] } as ColumnFilter;
  }

}
