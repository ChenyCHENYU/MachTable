import type { ColDef, ValueOutputTarget } from "../types/colDef";
import type { DictionaryEntry, DictionaryKey } from "./cachedDictionary";

export type DictionaryDisplay = "code" | "label" | "code-label";

/** Structural adapter for an existing provider; this helper never loads or caches remote data. */
export interface DictionaryColumnSource<TKey extends DictionaryKey = DictionaryKey> {
  get(key: TKey): string | undefined;
}

export interface DictionaryColumnOptions<TKey extends DictionaryKey = DictionaryKey> {
  /** Immutable snapshot for reverse parsing. Replace its identity when options change. */
  options?: readonly DictionaryEntry<TKey>[] | (() => readonly DictionaryEntry<TKey>[]);
  display?: DictionaryDisplay;
  /** Omitted targets preserve the original code and its type. */
  output?: Partial<Record<ValueOutputTarget, DictionaryDisplay>>;
}

const ambiguous = Symbol("ambiguous dictionary input");
type ParsedKey<TKey> = TKey | typeof ambiguous;

function addMatch<TKey>(index: Map<string, ParsedKey<TKey>>, text: string, key: TKey): void {
  const existing = index.get(text);
  index.set(text, existing !== undefined && existing !== key ? ambiguous : key);
}

function mergeMatch<TKey>(left: ParsedKey<TKey> | undefined, right: ParsedKey<TKey> | undefined): ParsedKey<TKey> | undefined {
  if (left === undefined) return right;
  return right === undefined || right === left ? left : ambiguous;
}

/** Explicit, synchronous dictionary presentation and typed IO; no existing defaults are changed. */
export function createDictionaryColumn<TData = any, TKey extends DictionaryKey = DictionaryKey>(
  source: DictionaryColumnSource<TKey>,
  config: DictionaryColumnOptions<TKey> = {}
): Partial<ColDef<TData>> {
  const empty: readonly DictionaryEntry<TKey>[] = [];
  let snapshot = empty;
  let byKey = new Map<TKey, DictionaryEntry<TKey>>();
  let byCode = new Map<string, ParsedKey<TKey>>();
  let byLabel = new Map<string, ParsedKey<TKey>>();
  let byCodeLabel = new Map<string, ParsedKey<TKey>>();

  const indexes = (): void => {
    const next = typeof config.options === "function" ? config.options() : config.options ?? empty;
    if (next === snapshot) return;
    const keys = new Map(next.map(entry => [entry.value, entry]));
    const codes = new Map<string, ParsedKey<TKey>>();
    const labels = new Map<string, ParsedKey<TKey>>();
    const combined = new Map<string, ParsedKey<TKey>>();
    for (const [key, entry] of keys) {
      addMatch(codes, String(key), key);
      addMatch(labels, entry.label, key);
      addMatch(combined, `${String(key)} · ${entry.label}`, key);
    }
    snapshot = next;
    byKey = keys;
    byCode = codes;
    byLabel = labels;
    byCodeLabel = combined;
  };
  const isKey = (value: unknown): value is TKey => typeof value === "string" || typeof value === "number";
  const label = (key: TKey): string | undefined => {
    indexes();
    return source.get(key) ?? byKey.get(key)?.label;
  };
  const format = (value: unknown, mode: DictionaryDisplay): string => {
    if (value == null || value === "") return "";
    if (!isKey(value)) return typeof value === "boolean" ? String(value) : "";
    const code = String(value);
    if (mode === "code") return code;
    const text = label(value);
    if (text === undefined) return code;
    return mode === "label" ? text : `${code} · ${text}`;
  };
  const parse = (value: unknown): unknown => {
    if (!isKey(value) || value === "") return value;
    indexes();
    // A typed raw code always wins over another entry's equal label (including 1 versus "1").
    if (byKey.has(value) || source.get(value) !== undefined || typeof value !== "string") return value;
    const match = byCode.get(value) ?? mergeMatch(byLabel.get(value), byCodeLabel.get(value));
    if (match === ambiguous) throw new TypeError(`[MachTable] Ambiguous dictionary value: ${value}`);
    return match ?? value;
  };

  return {
    valueFormatter: ({ value }) => format(value, config.display ?? "label"),
    valueParser: ({ value }) => parse(value),
    valueSerializer: ({ value, target }) => {
      const mode = config.output?.[target] ?? "code";
      return mode === "code" ? value : format(value, mode);
    }
  };
}
