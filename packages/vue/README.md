<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-vue

Official Vue 3 adapter for MachTable. It provides `<MachTable>` / `<RobotGrid>`, `useMachTable`, Vue cell/detail renderer factories, reactive option updates and automatic lifecycle cleanup.

## Install

```bash
pnpm add @agile-team/mach-table-vue
```

Import the stylesheet once from your application entry:

```ts
import "@agile-team/mach-table-vue/styles.css";
```

## Integration modes

### Local, route-level import

Best when only a few routes use a grid. A lazy-loaded route naturally keeps MachTable in that route's chunk.

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";

interface Row { id: string; name: string }
const grid = useMachTable<Row>();
const rows = ref<Row[]>([{ id: "1", name: "MachTable" }]);
const columns: ColDef<Row>[] = [{ field: "name", headerName: "Name", flex: 1 }];
</script>

<template>
  <div style="height: 520px">
    <MachTable
      :ref="grid.ref"
      :row-data="rows"
      :column-defs="columns"
      :get-row-id="({ data }) => data.id"
      striped-rows
    />
  </div>
</template>
```

### Global synchronous plugin

Best when most screens render tables. Components are available in every template without page-level runtime imports.

```ts
// main.ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(MachTablePlugin).mount("#app");
```

### Global async plugin

Best for large admin or low-code applications. The plugin is registered at startup, while the component and Core stay in a separate chunk until the first `<MachTable>` is rendered.

```ts
// main.ts
import { createApp } from "vue";
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(AsyncMachTablePlugin).mount("#app");

// Optional route-hover prefetch; dynamic imports are cached and idempotent.
void preloadMachTable();
```

After either global plugin is installed, pages can use `<MachTable>` or `<RobotGrid>` directly. Global component types are included for Volar and `vue-tsc`. A custom name and legacy alias policy are also supported:

```ts
app.use(MachTablePlugin, {
  componentName: "BusinessTable",
  registerRobotGridAlias: false
});
```

The adapter installs the matching `@agile-team/mach-table` core automatically and re-exports its complete API and types. Only `vue >= 3.2` remains a peer dependency supplied by the host application. Existing local imports remain fully supported.

Documentation: [Vue guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/vue.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [Element Plus](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/element-plus.md) · [Naive UI](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/naive-ui.md)

MIT © Agile Team
