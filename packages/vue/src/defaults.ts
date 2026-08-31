import { computed, inject, isRef, provide, shallowRef, type InjectionKey, type Ref } from "vue";
import {
  mergeMachTableConfig,
  normalizeMachTableConfig,
  type MachTableRuntimeConfig,
  type ResolvedMachTableConfig
} from "./configuration";

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
  return resolved;
}

export function useMachTableConfig(): Readonly<Ref<ResolvedMachTableConfig>> {
  return inject(MACH_TABLE_CONFIG_KEY, shallowRef(EMPTY_CONFIG));
}
