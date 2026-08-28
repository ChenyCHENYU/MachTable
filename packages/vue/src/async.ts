import { defineAsyncComponent, type App } from "vue";
import { registerGlobalMachTable, type MachTablePluginOptions } from "./globalRegistration";

/**
 * Starts loading the Vue adapter ahead of first render. The browser and bundler
 * cache the promise, so calling this on route hover is safe and idempotent.
 */
export const preloadMachTable = () => import("./RobotGrid").then(({ RobotGrid }) => RobotGrid);

/** Async global component used by AsyncMachTablePlugin. */
export const AsyncMachTable = defineAsyncComponent({
  loader: preloadMachTable
});

/**
 * Registers `<MachTable>` globally while keeping the component and Core in a
 * separate chunk until the first table is rendered.
 */
export const AsyncMachTablePlugin = Object.freeze({
  install(app: App, options: MachTablePluginOptions = {}): void {
    registerGlobalMachTable(app, AsyncMachTable, options);
  }
});

export type { MachTablePluginOptions } from "./globalRegistration";
export default AsyncMachTablePlugin;
