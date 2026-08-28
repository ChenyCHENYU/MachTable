<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-vue

Official Vue 3 adapter for MachTable. It provides `<MachTable>` / `<RobotGrid>`, `useMachTable`, Vue cell/detail renderer factories, reactive option updates and automatic lifecycle cleanup.

```bash
pnpm add @agile-team/mach-table-vue
```

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";

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

The adapter installs the matching `@agile-team/mach-table` core automatically and re-exports its complete API and types. Only `vue >= 3.2` remains a peer dependency supplied by the host application.

Documentation: [Vue guide](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/vue.md) · [Enterprise integration](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [Element Plus](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/element-plus.md) · [Naive UI](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/naive-ui.md)

MIT © Agile Team
