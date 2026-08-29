import { createApp } from "vue";
import AsyncMachTablePlugin from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";
import machTableConfig from "./mach-table.config";

createApp(App).use(AsyncMachTablePlugin, machTableConfig).mount("#app");
