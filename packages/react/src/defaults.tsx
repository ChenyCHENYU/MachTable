import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import {
  type MachTableRuntimeConfig,
  type ResolvedMachTableConfig,
} from "@agile-team/mach-table";
import { mergeMachTableConfig, normalizeMachTableConfig } from "@agile-team/mach-table/adapter";

const ROOT_CONFIG = normalizeMachTableConfig();
const MachTableConfigContext = createContext<ResolvedMachTableConfig>(ROOT_CONFIG);

export interface MachTableProviderProps {
  /** Full app/route configuration. Prefer importing this from mach-table.config.ts. */
  config?: MachTableRuntimeConfig;
  children?: ReactNode;
}

/** Supplies app-, route- or layout-scoped defaults without making tables eager. */
export function MachTableProvider({ config, children }: MachTableProviderProps) {
  const parent = useContext(MachTableConfigContext);
  const value = useMemo(
    () => mergeMachTableConfig(parent, config ?? {}),
    [parent, config]
  );
  return createElement(MachTableConfigContext.Provider, { value }, children);
}

export function useMachTableConfig(): ResolvedMachTableConfig {
  return useContext(MachTableConfigContext);
}
