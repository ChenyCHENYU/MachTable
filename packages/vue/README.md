<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-vue

MachTable 0.25 的官方 Vue 3 适配包。一个依赖即可获得 Core、泛型 `<MachTable>`、原生 slots、应用/路由配置、按需工作流、异步组件边界和自动生命周期清理。

```bash
pnpm add @agile-team/mach-table-vue
```

应用入口只引入一次样式：

```ts
import "@agile-team/mach-table-vue/styles.css";
```

## 局部接入

```vue
<script setup lang="ts">
import { ref } from "vue";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";

interface Row { id: string; name: string }
const table = useMachTable<Row>();
const rows = ref<Row[]>([{ id: "1", name: "MachTable" }]);
const columns: ColDef<Row>[] = [{ field: "name", flex: 1, editable: true }];
</script>

<template>
  <div style="height: 520px">
    <MachTable
      :ref="table.ref"
      :row-data="rows"
      :column-defs="columns"
      row-key="id"
      enable-column-resize
      :persistence="{ key: 'customers:list', sections: ['columns'] }"
    />
  </div>
</template>
```

## 全局接入

表格页面较多时，全局注册一次，页面模板直接使用 `<MachTable>`：

```ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import machTableConfig from "@/config/mach-table.config";

createApp(App).use(MachTablePlugin, machTableConfig).mount("#app");
```

需要减少首屏代码时改用异步全局插件：

```ts
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";

app.use(AsyncMachTablePlugin, machTableConfig);
void preloadMachTable(); // 可选：路由 hover 时预取
```

推荐把约定集中到独立文件：

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    columnLayout: "fit",
    enableColumnResize: true,
    defaultColDef: { sortable: true, filter: true, resizable: true }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ stripedRows: true }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow" })
  }
});
```

布局或路由可用响应式 `provideMachTableConfig()` 叠加配置，表格 props 始终拥有最高优先级。

## 按需子入口

```ts
import { useMachTableQuery, useMachTableEditing } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";
import { createElementPlusEditors } from "@agile-team/mach-table-vue/editors";
import { createWorkerDataProcessor } from "@agile-team/mach-table-vue/worker";
```

- `/workflows`：请求取消、防过期覆盖、服务端分页、跨页选择、脏数据和冲突保存；`reset()` 清空全部表格过滤且只请求一次。
- `/ui`：可选标准工具栏；需要全局组件时另行 `app.use(MachTableUiPlugin)`，其全局组件类型也只在导入该子入口后生效。
- `/adapters`：自定义 Vue renderer/editor/detail/overlay 桥接。
- `/editors`：可选 Element Plus 编辑器，Element Plus 由宿主注入。
- `/worker`：大型本地过滤/排序的独立 Worker 能力。

该包自动依赖 `@agile-team/mach-table` 并重导出 Core 类型；宿主只需提供 `vue >= 3.2`。

文档：[Vue 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/vue.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [配置中心](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/configuration.md)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
