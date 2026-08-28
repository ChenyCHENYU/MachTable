import { useMemo, useState, type MutableRefObject } from "react";
import type { GridApi } from "@agile-team/mach-table";

export interface UseMachGridReturn<TData = any> {
  apiRef: MutableRefObject<GridApi<TData> | null>;
  api: GridApi<TData> | null;
}

export function useMachGrid<TData = any>(): UseMachGridReturn<TData> {
  const [api, setApi] = useState<GridApi<TData> | null>(null);
  const apiRef = useMemo(() => {
    let current: GridApi<TData> | null = null;
    return Object.defineProperty({}, "current", {
      enumerable: true,
      get: () => current,
      set: (next: GridApi<TData> | null) => {
        if (next === current) return;
        current = next;
        setApi(next);
      }
    }) as MutableRefObject<GridApi<TData> | null>;
  }, []);

  return { apiRef, api };
}
