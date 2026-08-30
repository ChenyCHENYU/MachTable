import { EVENT_TYPES } from "../types/events";
import type { GridOptions } from "../types/options";
import {
  GRID_OPTION_META,
  type GridOptionKey,
  type GridOptionValueKind
} from "./gridOptionMetadata";

const EVENT_OPTION_KEYS = new Set(
  EVENT_TYPES.map((type) => `on${type.charAt(0).toUpperCase()}${type.slice(1)}`)
);

export function matchesGridOptionKind(value: unknown, kind: GridOptionValueKind): boolean {
  if (value == null || kind === "unknown") return true;
  if (kind === "array") return Array.isArray(value);
  if (kind === "boolean-object") {
    return typeof value === "boolean" || (typeof value === "object" && !Array.isArray(value));
  }
  if (kind === "object") return typeof value === "object" && !Array.isArray(value);
  if (kind === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === kind;
}

/**
 * Drops unknown and runtime-invalid options before they can partially mutate a grid.
 * Validation still reports the original patch, while this function guarantees that
 * JavaScript/JSON callers receive the same safety boundary as TypeScript callers.
 */
export function sanitizeGridOptionPatch<TData>(
  input: Partial<GridOptions<TData>> | Record<string, unknown>
): Partial<GridOptions<TData>> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (EVENT_OPTION_KEYS.has(key)) {
      if (value == null || typeof value === "function") output[key] = value;
      continue;
    }
    const metadata = GRID_OPTION_META[key as GridOptionKey];
    if (!metadata || !matchesGridOptionKind(value, metadata.kind)) continue;
    output[key] = value;
  }
  return output;
}
