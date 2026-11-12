import type { GridOptions, ResolvedGridOptions } from "../types/options";

/** Works with null-prototype records and ignores inherited option names. */
export function hasOwnOption<T extends object>(options: T, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(options, key);
}

/** Invalid numeric patches are ignored; initial resolution supplies its own fallback. */
export function normalizeFinite(value: unknown, min: number, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) return undefined;
  return integer ? Math.floor(value) : value;
}

/** Initial values and restored state share the same numeric bounds and fallback. */
export function finiteAtLeast(value: unknown, fallback: number, min: number, integer = false): number {
  return normalizeFinite(value, min, integer) ?? fallback;
}

/** 严格正数用于列宽及 flex；零仍可通过 normalizeFinite 单独保留。 */
export function normalizePositive(value: unknown): number | undefined {
  return normalizeFinite(value, 0) || undefined;
}

export function normalizePersistence(value: GridOptions["persistence"]): ResolvedGridOptions["persistence"] {
  if (!value || typeof value.key !== "string" || !value.key.trim()) return null;
  return {
    key: value.key.trim(),
    debounceMs: normalizeFinite(value.debounceMs, 0, true) ?? 160,
    ...(value.sections ? { sections: [...new Set(value.sections)] } : {}),
    ...(value.store ? { store: value.store } : {})
  };
}

/** Copy only explicit policy groups; callers retain the original ordering of observable effects. */
export function copyOptions<TSource extends object, K extends keyof TSource>(
  source: TSource, target: Pick<TSource, K>, keys: readonly K[], own = false
): boolean {
  let copied = false;
  for (const key of keys) {
    if (own ? hasOwnOption(source, key) : source[key] != null) {
      target[key] = source[key];
      copied = true;
    }
  }
  return copied;
}
