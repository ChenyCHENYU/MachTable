# Vue 3 接入

`@agile-team/mach-table-vue` 要求 Vue ≥ 3.2。规范组件名只有 `<MachTable>`；适配包自动依赖 Core，并重导出公共类型和能力。

```bash
pnpm add @agile-team/mach-table-vue
```

```ts
// main.ts：只引入一次
import "@agile-team/mach-table-vue/styles.css";
```

## 三种接入模式

### 局部导入

只有少量路由使用表格时，在页面正常 import。若路由本身懒加载，表格自然进入路由 chunk。

```vue
<script setup lang="ts">
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";

interface Order { id: string; product: string; amount: number }
const table = useMachTable<Order>();
const columns: ColDef<Order>[] = [
  { field: "product", headerName: "产品", flex: 1, editable: true },
  { field: "amount", headerName: "金额", width: 140, filter: "number" }
];
</script>

<template>
  <div style="height: 600px">
    <MachTable
      :ref="table.ref"
      :column-defs="columns"
      :row-data="rows"
      row-key="id"
    />
  </div>
</template>
```

### 同步全局插件

大多数页面都使用表格时，在入口注册一次，任意模板直接使用 `<MachTable>`。

```ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import machTableConfig from "@/config/mach-table.config";

createApp(App).use(MachTablePlugin, machTableConfig).mount("#app");
```

### 异步全局插件

中后台平台希望保持首屏轻量时，注册异步边界，组件与 Core 在第一次渲染表格时加载。

```ts
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";

app.use(AsyncMachTablePlugin, {
  ...machTableConfig,
  asyncComponentOptions: {
    loadingComponent: GridLoading,
    errorComponent: GridLoadError,
    delay: 120,
    timeout: 15_000,
    onError(error, retry, fail, attempts) {
      if (attempts <= 2) retry();
      else fail();
    }
  }
});

// 可选：在路由 hover 时预取；重复调用安全。
void preloadMachTable();
```

样式仍应同步引入，避免异步组件首次出现无样式闪烁。

## 专用配置文件

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

路由或布局可以响应式叠加：

```ts
provideMachTableConfig(() => ({
  defaults: { theme: dark.value ? "dark" : "light" }
}));
```

优先级为应用配置 → 路由/布局配置 → 命名预设 → 当前表格 props。详见[配置中心](/guide/configuration)。

## Props、事件和暴露实例

- 所有 `GridOptions` 都可作为 props；模板使用 kebab-case。
- `class/style/id/data-*/aria-*` 透传宿主；`grid-class-name` 作用于内部 grid 根元素。
- Core 事件以 Vue kebab-case 监听，如 `@selection-changed`。
- 组件暴露 `getApi()`、`getResolvedConfig()` 与 `explainOption()`。

```vue
<MachTable
  :ref="table.ref"
  :column-defs="columns"
  :row-data="rows"
  row-key="id"
  row-selection="multiple"
  enable-column-resize
  :persistence="{ key: 'tenant:user:orders' }"
  @selection-changed="onSelectionChanged"
  @grid-error="reportGridError"
/>
```

## `useMachTable()`

```ts
const table = useMachTable<Order>();

function exportCsv() {
  const csv = table.api.value?.io.exportCsv({ prependBOM: true });
}

function undo() {
  table.api.value?.editing.undo();
}
```

返回：

- `ref`：绑定 `<MachTable :ref="table.ref">`。
- `api`：挂载后的响应式领域 API，卸载后自动置空。
- `ready`：首个布局帧和 `gridReady` 完成后为 `true`。

## 原生 slots

列通过 `colId`（未配置时为 `field`）匹配 `#cell-*`、`#header-*` 与 `#editor-*`。还支持通用 `#cell/#header/#editor`、`#loading/#empty/#error/#detail/#actions`。

```vue
<MachTable :column-defs="columns" :row-data="rows" :loading="loading">
  <template #header-status>订单状态</template>
  <template #cell-status="{ value }">
    <ElTag :type="value === 'done' ? 'success' : 'warning'">{{ value }}</ElTag>
  </template>
  <template #editor-amount="{ value, setValue, commit, cancel }">
    <ElInputNumber
      :model-value="value"
      @update:model-value="setValue"
      @keyup.enter="commit"
      @keyup.esc="cancel"
    />
  </template>
  <template #loading><AppTableSkeleton /></template>
  <template #empty><AppEmpty description="暂无订单" /></template>
</MachTable>
```

slot 自动继承宿主 appContext，并在虚拟行复用、覆盖层替换和表格销毁时卸载。

## 可选工作流与 UI

```ts
import {
  useMachTableQuery,
  useMachTableEditing,
  useMachTableController
} from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
```

`useMachTableQuery` 管理请求取消、过期响应、分页、加载/空/错状态与跨页选择；`useMachTableEditing` 管理脏数据、部分成功和冲突；`useMachTableController` 将表格、查询、编辑、选择和工具栏命令组合为单个页面控制器。

工具栏需要全局注册时：

```ts
import MachTableUiPlugin from "@agile-team/mach-table-vue/ui";
app.use(MachTableUiPlugin);
```

## 自定义 renderer 和 editor

框架桥接函数从 `/adapters` 按需导入：

```ts
import { vueCellRenderer, vueDetailRenderer } from "@agile-team/mach-table-vue/adapters";
import StatusBadge from "./StatusBadge.vue";

const columns = [{ field: "status", cellRenderer: vueCellRenderer(StatusBadge) }];
```

通用 Vue 编辑器与 Element Plus 工厂从 `/editors` 导入：

```ts
import { vueCellEditor, createElementPlusEditors } from "@agile-team/mach-table-vue/editors";
```

纯文本格式化优先使用 `valueFormatter`，避免为每个可见单元格创建组件实例。

## 响应式更新

适配器只对实际变化的配置调用一次 `api.updateOptions()`。`rowData`、`columnDefs`、主题、密度、覆盖层和事件回调均可响应式更新；卸载时自动取消请求、监听器和渲染器。
