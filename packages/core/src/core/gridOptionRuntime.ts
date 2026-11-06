import { EVENT_TYPES } from "../types/events";
import type { GridOptions } from "../types/options";
import { normalizeFinite } from "../lib/optionValues";
import { GRID_OPTION_KINDS, type GridOptionKey } from "./gridOptionMetadata";

export const EVENT_OPTION_KEYS = new Set(
  EVENT_TYPES.map((type) => `on${type.charAt(0).toUpperCase()}${type.slice(1)}`)
);

export function matchesGridOptionValue(key: GridOptionKey, value: unknown): boolean {
  const kind = GRID_OPTION_KINDS[key];
  if (value == null || kind === "unknown") return true;
  if (kind === "array") return Array.isArray(value);
  if (kind === "number") return normalizeFinite(value, key === "maxBodyHeight" ? 1 : -Infinity) !== undefined;
  if (kind === "boolean-object" && typeof value === "boolean") return true;
  if (kind === "object-function" && typeof value === "function") return true;
  if (kind === "object" || kind === "boolean-object" || kind === "object-function") {
    return typeof value === "object" && !Array.isArray(value);
  }
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
    if (!Object.prototype.hasOwnProperty.call(GRID_OPTION_KINDS, key) || !matchesGridOptionValue(key as GridOptionKey, value)) continue;
    output[key] = value;
  }
  return output;
}
