import { createApp } from "vue";
import AsyncMachTablePlugin from "@agile-team/mach-table-vue/async";
import MachTableUiPlugin from "@agile-team/mach-table-vue/ui";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";
import machTableConfig from "./mach-table.config";

createApp(App)
  .use(AsyncMachTablePlugin, machTableConfig)
  .use(MachTableUiPlugin)
  .mount("#app");
