import { computed, inject, isRef, provide, shallowRef, type InjectionKey, type Ref } from "vue";
import type { GridOptions } from "@agile-team/mach-table";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  type MachTableRuntimeConfig,
  type ResolvedMachTableConfig
} from "./configuration";

export const MACH_TABLE_DEFAULTS_KEY: InjectionKey<Partial<GridOptions<any>>> = Symbol("mach-table-defaults");
export const MACH_TABLE_CONFIG_KEY: InjectionKey<Readonly<Ref<ResolvedMachTableConfig>>> = Symbol("mach-table-config");

export type MachTableConfigSource =
  | MachTableRuntimeConfig
  | Readonly<Ref<MachTableRuntimeConfig>>
  | (() => MachTableRuntimeConfig);

const EMPTY_CONFIG = normalizeMachTableConfig();

function readSource(source: MachTableConfigSource): MachTableRuntimeConfig {
  if (typeof source === "function") return source();
  return isRef(source) ? source.value : source;
}

export function createMachTableConfigRef(config: MachTableRuntimeConfig): Readonly<Ref<ResolvedMachTableConfig>> {
  return shallowRef(normalizeMachTableConfig(config));
}

/** Provides route/layout-scoped defaults, presets and diagnostics reactively. */
export function provideMachTableConfig(source: MachTableConfigSource): Readonly<Ref<ResolvedMachTableConfig>> {
  const parent = inject(MACH_TABLE_CONFIG_KEY, shallowRef(EMPTY_CONFIG));
  const resolved = computed(() => mergeMachTableConfig(parent.value, readSource(source)));
  provide(MACH_TABLE_CONFIG_KEY, resolved);
  // Keep the 0.x injection key available for consumers that injected it directly.
  provide(MACH_TABLE_DEFAULTS_KEY, resolved.value.defaults);
  return resolved;
}

/** Provides route/layout-scoped defaults. Per-table props always take precedence. */
export function provideMachTableDefaults<TData>(
  defaults: Partial<GridOptions<TData>> | Readonly<Ref<Partial<GridOptions<TData>>>> | (() => Partial<GridOptions<TData>>)
): void {
  provideMachTableConfig(() => ({
    defaults: typeof defaults === "function" ? defaults() : isRef(defaults) ? defaults.value : defaults
  }));
}

export function useMachTableDefaults<TData>(): Partial<GridOptions<TData>> {
  const config = inject(MACH_TABLE_CONFIG_KEY, null);
  if (config) return config.value.defaults as Partial<GridOptions<TData>>;
  return inject(MACH_TABLE_DEFAULTS_KEY, {}) as Partial<GridOptions<TData>>;
}

export function useMachTableConfig(): Readonly<Ref<ResolvedMachTableConfig>> {
  return inject(MACH_TABLE_CONFIG_KEY, shallowRef(EMPTY_CONFIG));
}
