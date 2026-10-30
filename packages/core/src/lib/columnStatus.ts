/** 状态列只影响显示；不会改写原值、排序、筛选或导出。 */
export type ColumnStatus = boolean | Readonly<Record<string, string | { label?: string; color?: string }>>;

export function ownEntry<T>(map: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

export function statusEntry(value: string | number | boolean | null | undefined, status?: ColumnStatus): { label?: string; color?: string } | undefined {
  if (value == null || value === "" || !status || typeof status !== "object") return undefined;
  const entry = ownEntry(status, String(value));
  return typeof entry === "string" ? { color: entry } : entry;
}
