import type { ColDef, CellRendererFn } from "../types/colDef";

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

export type DictionaryKey = string | number;

export interface DictionaryEntry<TKey extends DictionaryKey = DictionaryKey> {
  value: TKey;
  label: string;
}

export interface CachedDictionaryOptions<TKey extends DictionaryKey = DictionaryKey> {
  load(keys: readonly TKey[], signal: AbortSignal): Promise<readonly DictionaryEntry<TKey>[]>;
  ttlMs?: number;
  maxSize?: number;
  batchDelayMs?: number;
  onError?(error: unknown, keys: readonly TKey[]): void;
}

export interface CachedDictionary<TKey extends DictionaryKey = DictionaryKey> {
  get(key: TKey): string | undefined;
  resolve(key: TKey): Promise<string | undefined>;
  resolveMany(keys: readonly TKey[]): Promise<ReadonlyMap<TKey, string>>;
  prime(entries: readonly DictionaryEntry<TKey>[]): void;
  invalidate(keys?: readonly TKey[]): void;
  destroy(): void;
  readonly size: number;
}

interface DictionaryCacheValue<TKey extends DictionaryKey> {
  key: TKey;
  label: string;
  expiresAt: number;
}

function dictionaryId(key: DictionaryKey): string {
  return `${typeof key}:${String(key)}`;
}

/** Batched, de-duplicated TTL/LRU dictionary resolver for code-to-label fields. */
export function createCachedDictionary<TKey extends DictionaryKey = DictionaryKey>(
  options: CachedDictionaryOptions<TKey>
): CachedDictionary<TKey> {
  const ttlMs = Math.max(0, options.ttlMs ?? 5 * 60_000);
  const maxSize = Math.max(1, Math.floor(options.maxSize ?? 2_000));
  const delay = Math.max(0, options.batchDelayMs ?? 0);
  const cache = new Map<string, DictionaryCacheValue<TKey>>();
  const queued = new Map<string, TKey>();
  const waiting = new Map<string, Array<{ resolve(value: string | undefined): void; reject(error: unknown): void }>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let destroyed = false;

  const get = (key: TKey): string | undefined => {
    const id = dictionaryId(key);
    const hit = cache.get(id);
    if (!hit) return undefined;
    if (hit.expiresAt < Date.now()) {
      cache.delete(id);
      return undefined;
    }
    cache.delete(id);
    cache.set(id, hit);
    return hit.label;
  };

  const prime = (entries: readonly DictionaryEntry<TKey>[]): void => {
    const expiresAt = ttlMs === 0 ? Number.POSITIVE_INFINITY : Date.now() + ttlMs;
    for (const entry of entries) {
      const id = dictionaryId(entry.value);
      cache.delete(id);
      cache.set(id, { key: entry.value, label: String(entry.label), expiresAt });
    }
    while (cache.size > maxSize) cache.delete(cache.keys().next().value as string);
  };

  const flush = async (): Promise<void> => {
    timer = null;
    if (destroyed || queued.size === 0) return;
    const entries = [...queued.entries()];
    queued.clear();
    const keys = entries.map(([, key]) => key);
    const active = new AbortController();
    controller = active;
    try {
      const loaded = await options.load(keys, active.signal);
      if (destroyed || active.signal.aborted) return;
      prime(loaded);
      for (const [id, key] of entries) {
        const value = get(key);
        for (const waiter of waiting.get(id) ?? []) waiter.resolve(value);
        waiting.delete(id);
      }
    } catch (error) {
      if (!active.signal.aborted) options.onError?.(error, keys);
      for (const [id] of entries) {
        for (const waiter of waiting.get(id) ?? []) waiter.reject(error);
        waiting.delete(id);
      }
    } finally {
      if (controller === active) controller = null;
      if (!destroyed && queued.size > 0 && timer == null) timer = setTimeout(() => { void flush(); }, delay);
    }
  };

  const resolve = (key: TKey): Promise<string | undefined> => {
    const cached = get(key);
    if (cached !== undefined) return Promise.resolve(cached);
    if (destroyed) return Promise.reject(new Error("[MachTable] Dictionary resolver has been destroyed."));
    const id = dictionaryId(key);
    queued.set(id, key);
    const promise = new Promise<string | undefined>((resolveValue, reject) => {
      const list = waiting.get(id) ?? [];
      list.push({ resolve: resolveValue, reject });
      waiting.set(id, list);
    });
    if (timer == null && controller == null) timer = setTimeout(() => { void flush(); }, delay);
    return promise;
  };

  return {
    get,
    resolve,
    async resolveMany(keys) {
      const labels = await Promise.all(keys.map(async (key) => [key, await resolve(key)] as const));
      return new Map(labels.filter((entry): entry is readonly [TKey, string] => entry[1] !== undefined));
    },
    prime,
    invalidate(keys) {
      if (!keys) cache.clear();
      else for (const key of keys) cache.delete(dictionaryId(key));
    },
    destroy() {
      destroyed = true;
      if (timer != null) clearTimeout(timer);
      timer = null;
      controller?.abort();
      controller = null;
      const error = new Error("[MachTable] Dictionary resolver has been destroyed.");
      for (const waiters of waiting.values()) for (const waiter of waiters) waiter.reject(error);
      waiting.clear();
      queued.clear();
      cache.clear();
    },
    get size() {
      return cache.size;
    }
  };
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
    const element = document.createElement("span");
    element.className = "mach-dictionary-value mach-dictionary-value--loading";
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
