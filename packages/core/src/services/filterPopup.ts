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
    type: "text" | "number" | "date",
    filter: ColumnFilter | null
  ): void {
    const matches = type === "text" ? TEXT_MATCHES : type === "number" ? NUMBER_MATCHES : DATE_MATCHES;
    const existing =
      filter && filter.type !== "set" && filter.conditions.length > 0 ? filter.conditions[0] : null;
    const currentMatch: TextFilterMatch | NumberFilterMatch | DateFilterMatch =
      existing?.match ?? (type === "text" ? "contains" : "equals");
    const isBlank = currentMatch === "blank" || currentMatch === "notBlank";

    const select = el("select", "mach-filter-select") as HTMLSelectElement;
    for (const m of matches) {
      const option = document.createElement("option");
      option.value = m;
      option.textContent = this.core.getLocaleText(matchLocaleKey(m));
      select.appendChild(option);
    }
    select.value = currentMatch;

    const valueInput = el("input", "mach-filter-input") as HTMLInputElement;
    if (type === "number") valueInput.type = "number";
    if (type === "date") valueInput.type = "date";
    if (existing && existing.value != null && !isBlank) {
      valueInput.value = type === "date" ? String(existing.value).slice(0, 10) : String(existing.value);
    }

    const value2Input = el("input", "mach-filter-input mach-filter-input--second") as HTMLInputElement;
    if (type === "number") value2Input.type = "number";
    if (type === "date") value2Input.type = "date";
    if (existing && "value2" in existing && existing.value2 != null) {
      value2Input.value = String(existing.value2).slice(0, 10);
    }
    value2Input.style.display = currentMatch === "inRange" ? "" : "none";

    select.addEventListener("change", () => {
      const blank = select.value === "blank" || select.value === "notBlank";
      valueInput.style.display = blank ? "none" : "";
      value2Input.style.display = select.value === "inRange" ? "" : "none";
    });

    const enterApply = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const next = this.readFilter(panel);
        this.core.applyColumnFilter(column, next);
        this.close();
      }
    };
    valueInput.addEventListener("keydown", enterApply);
    value2Input.addEventListener("keydown", enterApply);

    const body = el("div", "mach-filter-body");
    body.append(select, valueInput, value2Input);
    panel.appendChild(body);
    panel.dataset.filterType = type;
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
        const key = v == null ? "__null__" : String(v);
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(v);
      }
    }

    const selected = new Set<string>(
      filter?.type === "set" ? filter.values.map((v) => (v == null ? "__null__" : String(v))) : values.map((v) => (v == null ? "__null__" : String(v)))
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
        const key = v == null ? "__null__" : String(v);
        valueByKey.set(key, v);
        const label = el("label", "mach-filter-set-item");
        const cb = document.createElement("input");
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
        checkboxes.push(cb);
      }
    };

    search.addEventListener("input", () => renderList(search.value));
    renderList("");
    panel.dataset.filterType = "set";
    panel.dataset.setValues = JSON.stringify([...valueByKey.entries()]);

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

    if (type === "set") {
      let entries: [string, string | number | null][] = [];
      try {
        entries = JSON.parse(panel.dataset.setValues ?? "[]");
      } catch {
        entries = [];
      }
      const selectedKeys = new Set<string>();
      panel.querySelectorAll<HTMLInputElement>(".mach-filter-set-item input:checked").forEach((cb) => {
        const item = cb.closest(".mach-filter-set-item")!;
        const span = item.querySelector("span")!;
        const emptyLabel = this.core.getLocaleText("emptySetLabel");
        const text = span.textContent === emptyLabel ? "__null__" : span.textContent ?? "";
        selectedKeys.add(text);
      });
      const picked = entries.filter(([key]) => selectedKeys.has(key)).map(([, v]) => v);
      if (picked.length === entries.length || picked.length === 0) return null;
      return { type: "set", values: picked };
    }

    const select = panel.querySelector<HTMLSelectElement>(".mach-filter-select");
    const inputs = panel.querySelectorAll<HTMLInputElement>(".mach-filter-input");
    const valueInput = inputs[0];
    const value2Input = inputs[1];
    if (!select || !valueInput) return null;

    const match = select.value;
    if (match === "blank" || match === "notBlank") {
      return { type, conditions: [{ match: match as "blank" | "notBlank" }] } as ColumnFilter;
    }
    const raw = valueInput.value;
    if (raw === "" && !(match === "inRange")) return null;

    if (type === "number") {
      const value = Number(raw);
      if (isNaN(value)) return null;
      if (match === "inRange") {
        const value2 = value2Input && value2Input.value !== "" ? Number(value2Input.value) : value;
        if (isNaN(value2)) return null;
        return { type: "number", conditions: [{ match: "inRange", value, value2 }] };
      }
      return { type: "number", conditions: [{ match: match as NumberFilterMatch, value }] };
    }

    if (type === "date") {
      const value = raw;
      if (match === "inRange") {
        const value2 = value2Input && value2Input.value !== "" ? value2Input.value : value;
        return { type: "date", conditions: [{ match: "inRange", value, value2 }] };
      }
      return { type: "date", conditions: [{ match: match as DateFilterMatch, value }] };
    }

    return { type: "text", conditions: [{ match: match as TextFilterMatch, value: raw }] };
  }
}
