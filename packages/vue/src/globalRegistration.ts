import type { App, Component } from "vue";
import type { GridOptions } from "@agile-team/mach-table";
import type { MachTable } from "./RobotGrid";
import { MACH_TABLE_DEFAULTS_KEY } from "./defaults";

declare module "vue" {
  export interface GlobalComponents {
    MachTable: typeof MachTable;
    RobotGrid: typeof MachTable;
  }
}

export interface MachTablePluginOptions {
  /** Global component name. Defaults to `MachTable`. */
  componentName?: string;
  /** Also register the backwards-compatible `RobotGrid` name. Defaults to true. */
  registerRobotGridAlias?: boolean;
  /** Application-wide defaults. Component props override these values. */
  defaults?: Partial<GridOptions<any>>;
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
  app.provide(MACH_TABLE_DEFAULTS_KEY, options.defaults ?? {});
  if (options.registerRobotGridAlias !== false) names.add("RobotGrid");

  for (const name of names) {
    const existing = app.component(name);
    if (existing && existing !== component) {
      throw new Error(`[MachTable] Cannot register global component \"${name}\" because that name is already in use.`);
    }
    if (!existing) app.component(name, component);
  }
}
