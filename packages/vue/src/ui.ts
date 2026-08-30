import type { App } from "vue";
import { MachTableToolbar } from "./MachTableToolbar";

/** Optional UI layer. Install once only when the standard toolbar is desired. */
export const MachTableUiPlugin = {
  install(app: App): void {
    if (!app.component("MachTableToolbar")) app.component("MachTableToolbar", MachTableToolbar);
  }
};

export { MachTableToolbar };
export type { MachTableToolbarFeatures } from "./MachTableToolbar";
export default MachTableUiPlugin;
