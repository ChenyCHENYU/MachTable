import type { ColDef, CellRendererFn } from "../types/colDef";
import { el } from "./dom";
import type { CachedDictionary, DictionaryKey } from "./cachedDictionary";
export { createCachedDictionary } from "./cachedDictionary";
export type { CachedDictionary, CachedDictionaryOptions, DictionaryEntry, DictionaryKey } from "./cachedDictionary";

export type BusinessColumnType =
  | "text"
  | "number"
  | "integer"
  | "money"
  | "percent"
  | "percentage"
  | "date"
  | "datetime"
  | "boolean"
  | "status"
  | "link";

export interface BusinessColumnTypeOptions {
  locale?: string | readonly string[];
  currency?: string;
  currencyDisplay?: "symbol" | "narrowSymbol" | "code" | "name";
  timeZone?: string;
  emptyText?: string;
  invalidText?: string;
  trueText?: string;
  falseText?: string;
  maximumFractionDigits?: number;
}

function present(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "";
}

function numeric(value: unknown): number | null {
  if (!present(value)) return null;
  const result = typeof value === "number" ? value : Number(value);
  return Number.isFinite(result) ? result : null;
}

function safeNumberFormat(
  locale: string | readonly string[] | undefined,
  options: Intl.NumberFormatOptions
): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(locale as string | string[] | undefined, options);
  } catch {
    return new Intl.NumberFormat(undefined, options);
  }
}

function safeDateFormat(
  locale: string | readonly string[] | undefined,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(locale as string | string[] | undefined, options);
  } catch {
    const portable = { ...options };
    delete portable.timeZone;
    return new Intl.DateTimeFormat(undefined, portable);
  }
}

function parseDate(value: unknown): Date | null {
  if (!present(value)) return null;
  const date = value instanceof Date ? value : new Date(value as string | number);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Production-oriented semantic column types. Register once in
 * `mach-table.config.ts`, then pages only declare `type: "money"` etc.
 */
export function createBusinessColumnTypes<TData = any>(
  options: BusinessColumnTypeOptions = {}
): Readonly<Record<BusinessColumnType, Partial<ColDef<TData>>>> {
  const empty = options.emptyText ?? "";
  const invalid = options.invalidText ?? "—";
  const numberFormat = safeNumberFormat(options.locale, {
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  });
  const integerFormat = safeNumberFormat(options.locale, { maximumFractionDigits: 0 });
  const moneyFormat = safeNumberFormat(options.locale, {
    style: "currency",
    currency: options.currency ?? "CNY",
    currencyDisplay: options.currencyDisplay ?? "symbol",
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  });
  const fractionPercentFormat = safeNumberFormat(options.locale, {
    style: "percent",
    maximumFractionDigits: options.maximumFractionDigits ?? 2
  });
  const dateFormat = safeDateFormat(options.locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  });
  const dateTimeFormat = safeDateFormat(options.locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    ...(options.timeZone ? { timeZone: options.timeZone } : {})
  });

  const formatNumber = (formatter: Intl.NumberFormat, scale = 1) => ({ value }: { value: unknown }): string => {
    if (!present(value)) return empty;
    const parsed = numeric(value);
    return parsed == null ? invalid : formatter.format(parsed * scale);
  };
  const formatDate = (formatter: Intl.DateTimeFormat) => ({ value }: { value: unknown }): string => {
    if (!present(value)) return empty;
    const parsed = parseDate(value);
    return parsed == null ? invalid : formatter.format(parsed);
  };

  return Object.freeze({
    text: { align: "left", filter: "text" },
    number: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: formatNumber(numberFormat)
    },
    integer: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: formatNumber(integerFormat)
    },
    money: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: formatNumber(moneyFormat)
    },
    /** Fraction input: 0.125 is displayed as 12.5%. */
    percent: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: formatNumber(fractionPercentFormat)
    },
    /** Whole-number input: 12.5 is displayed as 12.5%. */
    percentage: {
      align: "right",
      filter: "number",
      cellEditor: "number",
      valueFormatter: formatNumber(fractionPercentFormat, 0.01)
    },
    date: {
      align: "center",
      filter: "date",
      cellEditor: "date",
      valueFormatter: formatDate(dateFormat)
    },
    datetime: {
      align: "center",
      filter: "date",
      valueFormatter: formatDate(dateTimeFormat)
    },
    boolean: {
      align: "center",
      filter: "set",
      valueFormatter: ({ value }) => value === true
        ? (options.trueText ?? "是")
        : value === false
          ? (options.falseText ?? "否")
          : empty
    },
    status: { filter: "set", cellRenderer: "statusTag" },
    link: { filter: "text", cellRenderer: "link" }
  });
}

export interface DictionaryRendererOptions {
  loadingText?: string;
  emptyText?: string;
  fallback?: (value: DictionaryKey) => string;
}

/** Async-safe renderer backed by createCachedDictionary; stale pooled cells are not mutated. */
export function createDictionaryRenderer<TKey extends DictionaryKey = DictionaryKey>(
  dictionary: CachedDictionary<TKey>,
  options: DictionaryRendererOptions = {}
): CellRendererFn {
  return (params) => {
    if (!present(params.value)) return options.emptyText ?? "";
    const key = params.value as TKey;
    const fallback = options.fallback?.(key) ?? String(key);
    const cached = dictionary.get(key);
    if (cached !== undefined) return cached;
    const element = el("span", "mach-dictionary-value mach-dictionary-value--loading");
    element.textContent = options.loadingText ?? fallback;
    let active = true;
    void dictionary.resolve(key).then((label) => {
      if (!active || !element.isConnected) return;
      element.textContent = label ?? fallback;
      element.classList.remove("mach-dictionary-value--loading");
    }).catch(() => {
      if (!active || !element.isConnected) return;
      element.textContent = fallback;
      element.classList.remove("mach-dictionary-value--loading");
      element.classList.add("mach-dictionary-value--error");
    });
    return { el: element, destroy: () => { active = false; } };
  };
}
