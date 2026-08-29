import type { App } from "vue";
import { MachTable } from "./MachTable";
import { registerGlobalMachTable, type MachTablePluginOptions } from "./globalRegistration";

export const MachTablePlugin = {
  install(app: App, options?: MachTablePluginOptions): void {
    registerGlobalMachTable(app, MachTable, options);
  }
};

export type { MachTablePluginOptions } from "./globalRegistration";
