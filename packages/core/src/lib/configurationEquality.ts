/** Bounded structural comparison for small immutable config values, never row data. */
export function equivalentConfigValue(left: unknown, right: unknown, depth = 2): boolean {
  if (Object.is(left, right)) return true;
  if (depth <= 0) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || left.length > 100) return false;
    return left.every((value, index) => equivalentConfigValue(value, right[index], depth - 1));
  }
  if (!plain(left) || !plain(right)) return false;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length || keys.length > 100) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(right, key) &&
    equivalentConfigValue(left[key], right[key], depth - 1));
}

function plain(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

const MERGED_OPTIONS = new Set([
  "defaultColDef", "locale", "components", "columnTypes", "aggFuncs", "pagination", "statusBar", "watermark"
]);

/** Merged layers allocate fresh objects; preserve updates for genuine instance replacements. */
export function equivalentGridOption(key: string, left: unknown, right: unknown): boolean {
  return Object.is(left, right) || MERGED_OPTIONS.has(key) && equivalentConfigValue(left, right, 3);
}
