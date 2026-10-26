import type { GridOptions, ResolvedGridOptions } from "../types/options";

/** Invalid numeric patches are ignored; initial resolution supplies its own fallback. */
export function normalizeFinite(value: unknown, min: number, integer = false): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) return undefined;
  return integer ? Math.floor(value) : value;
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
    if (own ? Object.prototype.hasOwnProperty.call(source, key) : source[key] != null) {
      target[key] = source[key];
      copied = true;
    }
  }
  return copied;
}
