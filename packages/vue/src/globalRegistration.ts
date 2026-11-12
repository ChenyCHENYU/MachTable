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
  const existing = app.component("MachTable");
  if (existing && existing !== component) {
    throw new Error('[MachTable] "MachTable" already in use.');
  }
  // A rejected registration must leave the host application's config intact.
  app.provide(MACH_TABLE_CONFIG_KEY, createMachTableConfigRef(options));
  if (!existing) app.component("MachTable", component);
}
