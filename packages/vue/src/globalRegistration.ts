import type { App, Component } from "vue";
import type { MachTable } from "./RobotGrid";
import { createMachTableConfigRef, MACH_TABLE_CONFIG_KEY, MACH_TABLE_DEFAULTS_KEY } from "./defaults";
import type { MachTableRuntimeConfig } from "./configuration";

declare module "vue" {
  export interface GlobalComponents {
    MachTable: typeof MachTable;
    RobotGrid: typeof MachTable;
  }
}

export interface MachTablePluginOptions extends MachTableRuntimeConfig {
  /** Global component name. Defaults to `MachTable`. */
  componentName?: string;
  /** Also register the backwards-compatible `RobotGrid` name. Defaults to true. */
  registerRobotGridAlias?: boolean;
}

export function registerGlobalMachTable(
  app: App,
  component: Component,
  options: MachTablePluginOptions = {}
): void {
  const componentName = options.componentName ?? "MachTable";
  if (!componentName.trim()) {
    throw new Error("[MachTable] Global componentName must not be empty.");
  }

  const names = new Set([componentName]);
  const config = createMachTableConfigRef(options);
  app.provide(MACH_TABLE_CONFIG_KEY, config);
  app.provide(MACH_TABLE_DEFAULTS_KEY, config.value.defaults ?? {});
  if (options.registerRobotGridAlias !== false) names.add("RobotGrid");

  for (const name of names) {
    const existing = app.component(name);
    if (existing && existing !== component) {
      throw new Error(`[MachTable] Cannot register global component \"${name}\" because that name is already in use.`);
    }
    if (!existing) app.component(name, component);
  }
}
