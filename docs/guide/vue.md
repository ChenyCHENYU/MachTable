# Vue 3 接入

`@agile-team/mach-table-vue` 以 `<MachTable>` 为规范组件名，要求 Vue ≥ 3.2。旧名称 `<RobotGrid>` 在 0.x 期间保留为弃用别名，新代码请使用 `MachTable`。

## 安装

```bash
pnpm add @agile-team/mach-table-vue
```

适配包会自动安装匹配版本的 Core，并重导出完整 API、类型和主题样式；业务代码无需直接依赖 Core。

## 选择组件注入模式

### 局部导入

只有少量页面使用表格时，在页面中正常导入 `MachTable`。如果页面本身由 Vue Router 懒加载，表格代码会自然进入该路由 chunk，通常无需额外配置。

### 全局同步注入

大量页面都使用表格时，在应用入口注册一次，任意模板即可直接使用 `<MachTable>` / `<RobotGrid>`：

```ts
// main.ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(MachTablePlugin).mount("#app");
```

推荐把跨页面一致的配置放进独立的 `src/config/mach-table.config.ts`；应用入口只保留一行安装，单表 props 仍会覆盖全局值：

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig } from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    pagination: false,
    defaultColDef: { sortable: true, resizable: true, filter: true },
    onGridError: ({ code, error }) => telemetry.captureException(error, { tags: { code } })
  }
});

// main.ts
import machTableConfig from "@/config/mach-table.config";
createApp(App).use(MachTablePlugin, machTableConfig).mount("#app");
```

命名预设、语义列类型、动态路由配置、覆盖优先级和配置诊断见[配置中心与覆盖规则](/guide/configuration)。布局或路由可调用 `provideMachTableConfig(...)`，只覆盖默认值时也可继续使用 `provideMachTableDefaults(...)`。

默认全局名称已包含 Volar / `vue-tsc` 类型。需要统一业务命名时可以配置：

```ts
app.use(MachTablePlugin, {
  componentName: "BusinessTable",
  registerRobotGridAlias: false
});
```

### 全局异步注入（大型项目推荐）

应用启动时只注册异步边界，首次真正渲染表格时才请求 Vue 适配组件与 Core：

```ts
// main.ts
import { createApp } from "vue";
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";

createApp(App).use(AsyncMachTablePlugin).mount("#app");

// 可选：路由 hover、空闲时段或权限菜单预取时调用。
void preloadMachTable();
```

生产项目可配置异步加载/错误边界：

```ts
app.use(AsyncMachTablePlugin, {
  defaults: { size: "compact" },
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
```

页面无需运行时 import 组件：

```vue
<template>
  <MachTable :column-defs="columnDefs" :row-data="rowData" />
</template>
```

主题 CSS 只有约 5 KB gzip，建议始终在应用入口同步引入，避免异步组件出现无样式闪烁。`preloadMachTable()` 使用浏览器模块缓存，多次调用是安全的。

## 基础用法

```vue
<script setup lang="ts">
import { ref } from "vue";
import "@agile-team/mach-table-vue/styles.css";
import { MachTable } from "@agile-team/mach-table-vue";
import type {
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  GridApi,
  SelectionChangedEvent
} from "@agile-team/mach-table-vue";

interface Order { id: string; product: string; qty: number; region: string }

const rowData = ref<Order[]>([]);
const grid = ref<{ getApi: () => GridApi<Order> | null } | null>(null);
const selectedCount = ref(0);

const columnDefs: ColDef<Order>[] = [
  { colId: "sel", headerName: "", width: 46, checkboxSelection: true },
  { field: "product", headerName: "产品", flex: 1, editable: true, filter: "text" },
  { field: "qty", headerName: "数量", width: 100, filter: "number", editable: true },
  { field: "region", headerName: "区域", width: 110, filter: "set" }
];

const getRowId = ({ data }: GetRowIdParams<Order>) => data.id;
const onSelectionChanged = (event: SelectionChangedEvent<Order>) => {
  selectedCount.value = event.selectedRows.length;
};
const onCellValueChanged = (event: CellValueChangedEvent<Order>) => {
  console.info(event.colDef.field, event.newValue);
};
</script>

<template>
  <div style="height: 600px">
    <MachTable
      ref="grid"
      :column-defs="columnDefs"
      :row-data="rowData"
      row-selection="multiple"
      :get-row-id="getRowId"
      striped-rows
      @selection-changed="onSelectionChanged"
      @cell-value-changed="onCellValueChanged"
    />
  </div>
</template>
```

## Props / Emits / Expose

**Props**：所有 GridOptions 项均声明为 props（kebab-case 传参），完整清单见 [GridOptions](/api/grid-options)。

`class` / `style` / `id` / `data-*` / `aria-*` 等普通属性透传到宿主元素；`grid-class-name` 单独作用于内部 `.mach-root`。

**Emits**：`EVENT_TYPES` 中的全部事件以 camelCase 名 emit，模板中用 kebab-case 监听：

```vue
<MachTable
  @grid-ready="onReady"
  @cell-clicked="onCell"
  @selection-changed="onSel"
  @sort-changed="onSort"
  @range-selection-changed="onRange"
  @detail-toggled="onDetail"
/>
```

**Expose**：`getApi(): GridApi | null` —— 模板 ref 获取命令 API。

## useMachTable 组合式 API（推荐）

免去手动 ref + getApi 模板代码：

```vue
<script setup lang="ts">
import { MachTable, useMachTable } from "@agile-team/mach-table-vue";

const mt = useMachTable<Order>();

function exportCsv() {
  mt.api.value?.getDataAsCsv({ prependBOM: true });
}
</script>

<template>
  <MachTable :ref="mt.ref" :column-defs="defs" :row-data="rows" row-selection="multiple" />
  <span v-if="mt.ready.value">共 {{ mt.api.value?.getTotalRowCount() }} 行</span>
</template>
```

## 适配器上下文自动继承

在 `<script setup>` 内调用 `vueCellRenderer` / `vueDetailRenderer` 工厂时会**自动捕获宿主 appContext**：单元格与明细内的 naive / EP 组件可继承 `ConfigProvider` 提供的主题、国际化等注入（也可通过第二参数 `{ appContext }` 显式指定）。这让 naive-ui 集成章节所述的上下文限制不再存在。

## Vue 原生插槽

常用页面不必再手写 renderer 工厂。列以 `colId`（未配置时为 `field`）匹配 `#cell-*`、`#header-*` 和 `#editor-*`；点路径会转换为短横线。

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
  <template #detail="{ data }"><OrderDetail :order="data" /></template>
</MachTable>
```

通用 `#cell` / `#header` / `#editor` 会作用于所有列；操作列 `colId: "op"` 还可使用 `#actions`。插槽组件继承应用 `appContext`，并在虚拟行复用、覆盖层替换和表格销毁时自动卸载。

`mt.ref` 绑定组件、挂载后 `mt.api` 自动可用、卸载自动置空；`mt.ready` 便于做加载态。

## 响应式更新语义

| Prop 变化 | 行为 |
| --- | --- |
| `rowData` | `api.setRowData` 全量替换 |
| `columnDefs` | `api.setColumnDefs`（列状态保留） |
| `quickFilterText` | `api.setQuickFilter` |
| 尺寸/主题/选择/摘要/固定行/提示/状态栏/覆盖层等 | watch → `api.updateOptions` 增量应用 |

`onMounted` 创建、`onBeforeUnmount` 自动 `destroy`。

## Vue 单元格渲染器

```ts
import { h } from "vue";
import { NTag } from "naive-ui";        // 或 ElTag
import { vueCellRenderer } from "@agile-team/mach-table-vue";

const columnDefs: ColDef<Order>[] = [
  {
    field: "region",
    headerName: "区域",
    cellRenderer: vueCellRenderer({
      render: () => h(NTag, { type: "success", size: "small" }, () => "华东")
    })
  }
];
```

`vueCellRenderer(component)` 直接传 SFC 组件亦可：

```ts
import StatusBadge from "./StatusBadge.vue";
cellRenderer: vueCellRenderer(StatusBadge)
```

::: tip 上下文自动继承
适配器在组件 `setup` 内调用时会自动捕获宿主 appContext —— ConfigProvider 的主题、国际化注入随单元格生效。仅在模块顶层调用（无宿主实例）时才退化为独立根渲染，此时可用第二参数显式指定：`vueCellRenderer(Comp, { appContext })`。
:::

## 明细行渲染 Vue 组件

```ts
import { vueDetailRenderer } from "@agile-team/mach-table-vue";
import OrderDetailPanel from "./OrderDetailPanel.vue";

<MachTable master-detail :detail-row-height="280"
           :detail-row-renderer="vueDetailRenderer(OrderDetailPanel)" ... />
```

## 自定义编辑器（挂任意 Vue 组件）

```ts
import { vueCellEditor } from "@agile-team/mach-table-vue/editors";

const departmentEditor = vueCellEditor(DepartmentSelect, {
  props: ({ data }) => ({ tenantId: data.tenantId }),
  focusSelector: "input"
});

const columns = [
  { field: "departmentId", editable: true, cellEditor: departmentEditor }
];
```

Element Plus 常用编辑器可以一次注册为字符串名称，见[Element Plus 集成](/guide/element-plus)。工厂统一处理 v-model、可选宿主 appContext、聚焦和销毁，不要在每次编辑时手写 `createApp()`。
