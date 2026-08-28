import type { ColumnState } from "../types/colDef";

export function saveColumnState(key: string, state: ColumnState[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(`mach-table:col-state:${key}`, JSON.stringify(state));
  } catch {
    void 0;
  }
}

export function loadColumnState(key: string): ColumnState[] | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(`mach-table:col-state:${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (s): s is ColumnState => s != null && typeof s === "object" && typeof s.colId === "string"
    );
  } catch {
    return null;
  }
}

export function clearColumnState(key: string): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(`mach-table:col-state:${key}`);
  } catch {
    void 0;
  }
}
