import type { App } from "vue";
import { RobotGrid } from "./RobotGrid";
import { registerGlobalMachTable, type MachTablePluginOptions } from "./globalRegistration";

export const MachTablePlugin = Object.freeze({
  install(app: App, options: MachTablePluginOptions = {}): void {
    registerGlobalMachTable(app, RobotGrid, options);
  }
});

export type { MachTablePluginOptions } from "./globalRegistration";
