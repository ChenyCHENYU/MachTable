import { defineAsyncComponent, type App, type Component } from "vue";
import { registerGlobalMachTable, type MachTablePluginOptions } from "./globalRegistration";

/**
 * Starts loading the Vue adapter ahead of first render. The browser and bundler
 * cache the promise, so calling this on route hover is safe and idempotent.
 */
export const preloadMachTable = () => import("./RobotGrid").then(({ MachTable }) => MachTable);

export interface AsyncMachTableOptions {
  loadingComponent?: Component;
  errorComponent?: Component;
  delay?: number;
  timeout?: number;
  suspensible?: boolean;
  onError?: (error: Error, retry: () => void, fail: () => void, attempts: number) => void;
}

/** Creates a route-friendly async component with optional loading/error boundaries. */
export function createAsyncMachTable(options: AsyncMachTableOptions = {}) {
  return defineAsyncComponent({ loader: preloadMachTable, ...options });
}

/** Async global component used by AsyncMachTablePlugin. */
export const AsyncMachTable = createAsyncMachTable();

export interface AsyncMachTablePluginOptions extends MachTablePluginOptions {
  asyncComponentOptions?: AsyncMachTableOptions;
}

/**
 * Registers `<MachTable>` globally while keeping the component and Core in a
 * separate chunk until the first table is rendered.
 */
export const AsyncMachTablePlugin = Object.freeze({
  install(app: App, options: AsyncMachTablePluginOptions = {}): void {
    const component = options.asyncComponentOptions
      ? createAsyncMachTable(options.asyncComponentOptions)
      : AsyncMachTable;
    registerGlobalMachTable(app, component, options);
  }
});

export type { MachTablePluginOptions } from "./globalRegistration";
export default AsyncMachTablePlugin;
