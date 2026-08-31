import type { GridCore } from "../core/gridCore";
import type { Column } from "./column";
import type {
  ColumnFilter,
  DateFilterMatch,
  NumberFilterMatch,
  TextFilterMatch
} from "../types/colDef";
import { el, clamp } from "../lib/dom";
import { matchLocaleKey } from "../lib/locale";

type FilterPopupContext = Pick<
  GridCore<any>,
  "applyColumnFilter" | "getCellValue" | "getLocaleText" | "rowModel"
>;

const TEXT_MATCHES: TextFilterMatch[] = [
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "startsWith",
  "endsWith",
  "blank",
  "notBlank"
];
const NUMBER_MATCHES: NumberFilterMatch[] = [
  "equals",
  "notEquals",
  "lessThan",
  "lessThanOrEqual",
  "greaterThan",
  "greaterThanOrEqual",
  "inRange",
  "blank",
  "notBlank"
];
const DATE_MATCHES: DateFilterMatch[] = ["equals", "notEquals", "lessThan", "greaterThan", "inRange", "blank", "notBlank"];

type ConditionFilterType = "text" | "number" | "date";
type ConditionMatch = TextFilterMatch | NumberFilterMatch | DateFilterMatch;

function isBlankMatch(match: string): boolean {
  return match === "blank" || match === "notBlank";
}

function conditionMatches(type: ConditionFilterType): readonly ConditionMatch[] {
  if (type === "number") return NUMBER_MATCHES;
  if (type === "date") return DATE_MATCHES;
  return TEXT_MATCHES;
}

function setValueKey(value: string | number | null): string {
  if (value === null) return "null:";
  return `${typeof value}:${String(value)}`;
}

export class FilterPopupService {
  private panel: HTMLElement | null = null;
  private openColId: string | null = null;

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
    if (this.panel && !this.panel.contains(e.target as Node)) this.close();
  };

  private docKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.close();
  };

  private open(column: Column, anchor: HTMLElement): void {
    const filter = this.core.rowModel.getFilterModel()[column.id] ?? null;
    const type = filter?.type ?? column.filterType;
    const panel = el("div", "mach-filter-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", `${column.id} filter`);

    if (type === "set") this.buildSetBody(panel, column, filter);
    else this.buildConditionBody(panel, column, type, filter);

    const footer = el("div", "mach-filter-footer");
    const resetBtn = el("button", "mach-filter-btn-reset") as HTMLButtonElement;
    resetBtn.type = "button";
    resetBtn.textContent = this.core.getLocaleText("reset");
    resetBtn.addEventListener("click", () => {
      this.core.applyColumnFilter(column, null);
      this.close();
    });
    const applyBtn = el("button", "mach-filter-btn-apply") as HTMLButtonElement;
    applyBtn.type = "button";
    applyBtn.textContent = this.core.getLocaleText("apply");
    applyBtn.addEventListener("click", () => {
      const next = this.readFilter(panel);
      this.core.applyColumnFilter(column, next);
      this.close();
    });
    footer.append(resetBtn, applyBtn);
    panel.appendChild(footer);

    document.body.appendChild(panel);
    this.panel = panel;
    this.openColId = column.id;

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
    const firstInput = panel.querySelector<HTMLInputElement>("input, select");
    firstInput?.focus();
  }

  close(): void {
    if (!this.panel) return;
    this.panel.remove();
    this.panel = null;
    this.openColId = null;
    document.removeEventListener("mousedown", this.docMouseDown, true);
    document.removeEventListener("keydown", this.docKeyDown, true);
  }

  destroy(): void {
    this.close();
  }

  private buildConditionBody(
    panel: HTMLElement,
    column: Column,
    type: ConditionFilterType,
    filter: ColumnFilter | null
  ): void {
    const existing =
      filter && filter.type !== "set" && filter.conditions.length > 0 ? filter.conditions[0] : null;
    const currentMatch: ConditionMatch =
      existing?.match ?? (type === "text" ? "contains" : "equals");
    const select = this.createConditionSelect(type, currentMatch);
    const valueInput = this.createConditionInput(type);
    const value2Input = this.createConditionInput(type, true);
    this.populateConditionInputs(type, currentMatch, existing, valueInput, value2Input);
    this.updateConditionInputVisibility(currentMatch, valueInput, value2Input);
    select.addEventListener("change", () => {
      this.updateConditionInputVisibility(select.value, valueInput, value2Input);
    });
    this.attachEnterApply(column, panel, valueInput, value2Input);

    const body = el("div", "mach-filter-body");
    body.append(select, valueInput, value2Input);
    panel.appendChild(body);
    panel.dataset.filterType = type;
  }

  private createConditionSelect(type: ConditionFilterType, current: ConditionMatch): HTMLSelectElement {
    const select = el("select", "mach-filter-select") as HTMLSelectElement;
    for (const match of conditionMatches(type)) {
      const option = document.createElement("option");
      option.value = match;
      option.textContent = this.core.getLocaleText(matchLocaleKey(match));
      select.appendChild(option);
    }
    select.value = current;
    return select;
  }

  private createConditionInput(type: ConditionFilterType, second = false): HTMLInputElement {
    const className = `mach-filter-input${second ? " mach-filter-input--second" : ""}`;
    const input = el("input", className) as HTMLInputElement;
    if (type === "number") input.type = "number";
    if (type === "date") input.type = "date";
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

  private attachEnterApply(
    column: Column,
    panel: HTMLElement,
    valueInput: HTMLInputElement,
    value2Input: HTMLInputElement
  ): void {
    const enterApply = (e: KeyboardEvent) => {
      if (e.key !== "Enter") return;
      this.core.applyColumnFilter(column, this.readFilter(panel));
      this.close();
    };
    valueInput.addEventListener("keydown", enterApply);
    value2Input.addEventListener("keydown", enterApply);
  }

  private buildSetBody(panel: HTMLElement, column: Column, filter: ColumnFilter | null): void {
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
        const v = this.core.getCellValue(nodes[i], column);
        const key = setValueKey(v == null ? null : v);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(v);
      }
    }

    const selected = new Set<string>(
      filter?.type === "set" ? filter.values.map(setValueKey) : values.map(setValueKey)
    );

    const search = el("input", "mach-filter-input mach-filter-input--search") as HTMLInputElement;
    search.type = "text";
    search.placeholder = this.core.getLocaleText("search");

    const list = el("div", "mach-filter-set-list");
    const checkboxes: HTMLInputElement[] = [];
    const valueByKey = new Map<string, string | number | null>();

    const renderList = (query: string) => {
      list.textContent = "";
      checkboxes.length = 0;
      const q = query.trim().toLowerCase();
      for (const v of values) {
        const text = v == null ? this.core.getLocaleText("emptySetLabel") : String(v);
        if (q && !text.toLowerCase().includes(q)) continue;
        const key = setValueKey(v);
        valueByKey.set(key, v);
        const label = el("label", "mach-filter-set-item");
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = selected.has(key);
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(key);
          else selected.delete(key);
          panel.dataset.setSelected = JSON.stringify([...selected]);
        });
        const span = el("span");
        span.textContent = text;
        label.append(cb, span);
        list.appendChild(label);
        checkboxes.push(cb);
      }
    };

    search.addEventListener("input", () => renderList(search.value));
    renderList("");
    panel.dataset.filterType = "set";
    panel.dataset.setValues = JSON.stringify([...valueByKey.entries()]);
    panel.dataset.setSelected = JSON.stringify([...selected]);

    const updateSetValues = () => {
      const entries = [...valueByKey.entries()];
      panel.dataset.setValues = JSON.stringify(entries);
    };
    updateSetValues();

    const body = el("div", "mach-filter-body mach-filter-body--set");
    body.append(search, list);
    panel.appendChild(body);
  }

  private readFilter(panel: HTMLElement): ColumnFilter | null {
    const type = panel.dataset.filterType;
    if (type === "set") return this.readSetFilter(panel);
    if (type !== "text" && type !== "number" && type !== "date") return null;

    const select = panel.querySelector<HTMLSelectElement>(".mach-filter-select");
    const inputs = panel.querySelectorAll<HTMLInputElement>(".mach-filter-input");
    const valueInput = inputs[0];
    const value2Input = inputs[1];
    if (!select || !valueInput) return null;

    const match = select.value;
    if (isBlankMatch(match)) {
      return { type, conditions: [{ match: match }] } as ColumnFilter;
    }
    const raw = valueInput.value;
    if (raw === "" && !(match === "inRange")) return null;
    if (type === "number") return this.readNumberFilter(match, raw, value2Input);
    if (type === "date") return this.readDateFilter(match, raw, value2Input);
    return { type: "text", conditions: [{ match: match as TextFilterMatch, value: raw }] };
  }

  private readSetFilter(panel: HTMLElement): ColumnFilter | null {
    let entries: [string, string | number | null][] = [];
    let selectedKeys: string[] = [];
    try {
      entries = JSON.parse(panel.dataset.setValues ?? "[]");
      selectedKeys = JSON.parse(panel.dataset.setSelected ?? "[]");
    } catch {
      return null;
    }
    const selected = new Set(selectedKeys);
    const picked = entries.filter(([key]) => selected.has(key)).map(([, value]) => value);
    if (picked.length === entries.length || picked.length === 0) return null;
    return { type: "set", values: picked };
  }

  private readNumberFilter(
    match: string,
    raw: string,
    value2Input: HTMLInputElement | undefined
  ): ColumnFilter | null {
    const value = Number(raw);
    if (Number.isNaN(value)) return null;
    if (match !== "inRange") {
      return { type: "number", conditions: [{ match: match as NumberFilterMatch, value }] };
    }
    const value2 = value2Input?.value ? Number(value2Input.value) : value;
    if (Number.isNaN(value2)) return null;
    return { type: "number", conditions: [{ match: "inRange", value, value2 }] };
  }

  private readDateFilter(
    match: string,
    value: string,
    value2Input: HTMLInputElement | undefined
  ): ColumnFilter {
    if (match !== "inRange") {
      return { type: "date", conditions: [{ match: match as DateFilterMatch, value }] };
    }
    return {
      type: "date",
      conditions: [{ match: "inRange", value, value2: value2Input?.value || value }]
    };
  }
}
