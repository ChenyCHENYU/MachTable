import { useMemo, useState, type MutableRefObject } from "react";
import type { GridApi } from "@agile-team/mach-table";

export interface UseMachGridReturn<TData = any> {
  apiRef: MutableRefObject<GridApi<TData> | null>;
  api: GridApi<TData> | null;
  ready: boolean;
}

export function useMachGrid<TData = any>(): UseMachGridReturn<TData> {
  const [api, setApi] = useState<GridApi<TData> | null>(null);
  const [ready, setReady] = useState(false);
  const apiRef = useMemo(() => {
    let current: GridApi<TData> | null = null;
    return Object.defineProperty({}, "current", {
      enumerable: true,
      get: () => current,
      set: (next: GridApi<TData> | null) => {
        if (next === current) return;
        current = next;
        setApi(next);
        setReady(false);
        if (next) {
          void next.whenReady().then(() => {
            if (current === next && !next.isDestroyed()) setReady(true);
          });
        }
      }
    }) as MutableRefObject<GridApi<TData> | null>;
  }, []);

  return { apiRef, api, ready };
}
