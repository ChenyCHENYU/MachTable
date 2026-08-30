import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  type GridOptions,
  type MachTableRuntimeConfig,
  type ResolvedMachTableConfig
} from "@agile-team/mach-table";

const ROOT_CONFIG = normalizeMachTableConfig();
const MachTableConfigContext = createContext<ResolvedMachTableConfig>(ROOT_CONFIG);

export interface MachTableProviderProps<TData = any> {
  /** Full app/route configuration. Prefer importing this from mach-table.config.ts. */
  config?: MachTableRuntimeConfig;
  /** Backwards-compatible shorthand for config.defaults. */
  defaults?: Partial<GridOptions<TData>>;
  children?: ReactNode;
}

/** Supplies app-, route- or layout-scoped defaults without making tables eager. */
export function MachTableProvider<TData = any>({ config, defaults, children }: MachTableProviderProps<TData>) {
  const parent = useContext(MachTableConfigContext);
  const value = useMemo(
    () => mergeMachTableConfig(parent, { ...(config ?? {}), ...(defaults ? { defaults } : {}) }),
    [parent, config, defaults]
  );
  return createElement(MachTableConfigContext.Provider, { value }, children);
}

export function useMachTableDefaults<TData = any>(): Partial<GridOptions<TData>> {
  return useContext(MachTableConfigContext).defaults as Partial<GridOptions<TData>>;
}

export function useMachTableConfig(): ResolvedMachTableConfig {
  return useContext(MachTableConfigContext);
}
