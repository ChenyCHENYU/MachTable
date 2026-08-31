import type { App, Component } from "vue";
import type { MachTable } from "./MachTable";
import { createMachTableConfigRef, MACH_TABLE_CONFIG_KEY } from "./defaults";
import type { MachTableRuntimeConfig } from "./configuration";

declare module "vue" {
  export interface GlobalComponents {
    MachTable: typeof MachTable;
  }
}

export type MachTablePluginOptions = MachTableRuntimeConfig;

export function registerGlobalMachTable(
  app: App,
  component: Component,
  options: MachTablePluginOptions = {}
): void {
  const config = createMachTableConfigRef(options);
  app.provide(MACH_TABLE_CONFIG_KEY, config);
  const existing = app.component("MachTable");
  if (existing && existing !== component) {
    throw new Error('[MachTable] Cannot register global component "MachTable" because that name is already in use.');
  }
  if (!existing) app.component("MachTable", component);
}
