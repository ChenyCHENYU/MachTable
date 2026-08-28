import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { createMachTablePreset, type GridOptions } from "@agile-team/mach-table";

const MachTableDefaultsContext = createContext<Partial<GridOptions<any>>>({});

export interface MachTableProviderProps<TData = any> {
  defaults: Partial<GridOptions<TData>>;
  children?: ReactNode;
}

/** Supplies app-, route- or layout-scoped defaults without making tables eager. */
export function MachTableProvider<TData = any>({ defaults, children }: MachTableProviderProps<TData>) {
  const parent = useContext(MachTableDefaultsContext);
  const value = useMemo(() => createMachTablePreset(parent, defaults), [parent, defaults]);
  return createElement(MachTableDefaultsContext.Provider, { value }, children);
}

export function useMachTableDefaults<TData = any>(): Partial<GridOptions<TData>> {
  return useContext(MachTableDefaultsContext) as Partial<GridOptions<TData>>;
}
