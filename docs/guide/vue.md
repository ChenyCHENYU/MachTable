# Vue 3 接入

`@agile-team/mach-table-vue` 提供 `<RobotGrid>` 组件（并导出语义化别名 `<MachTable>`）与 Vue 适配器，要求 vue ≥ 3.2。

## 安装

```bash
pnpm add @agile-team/mach-table @agile-team/mach-table-vue
```

## 基础用法

```vue
<script setup lang="ts">
import { ref } from "vue";
import "@agile-team/mach-table/styles/mach-table.css";
import { RobotGrid } from "@agile-team/mach-table-vue";
import type {
  CellValueChangedEvent,
  ColDef,
  GetRowIdParams,
  GridApi,
  SelectionChangedEvent
} from "@agile-team/mach-table";

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
    <RobotGrid
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
<RobotGrid
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
import { RobotGrid, useMachTable } from "@agile-team/mach-table-vue";

const mt = useMachTable<Order>();

function exportCsv() {
  mt.api.value?.getDataAsCsv({ prependBOM: true });
}
</script>

<template>
  <RobotGrid :ref="mt.ref" :column-defs="defs" :row-data="rows" row-selection="multiple" />
  <span v-if="mt.ready.value">共 {{ mt.api.value?.getTotalRowCount() }} 行</span>
</template>
```

## 适配器上下文自动继承

在 `<script setup>` 内调用 `vueCellRenderer` / `vueDetailRenderer` 工厂时会**自动捕获宿主 appContext**：单元格与明细内的 naive / EP 组件可继承 `ConfigProvider` 提供的主题、国际化等注入（也可通过第二参数 `{ appContext }` 显式指定）。这让 naive-ui 集成章节所述的上下文限制不再存在。

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

<RobotGrid master-detail :detail-row-height="280"
           :detail-row-renderer="vueDetailRenderer(OrderDetailPanel)" ... />
```

## 自定义编辑器（挂任意 Vue 组件）

```ts
cellEditor: (params) => {
  const host = document.createElement("div");
  let value = params.value;
  const app = createApp({
    render: () =>
      h(ElSelect, {
        modelValue: value,
        "onUpdate:modelValue": (v: any) => (value = v),
        filterable: true
      }, () => options.map((o) => h(ElOption, { key: o, value: o, label: o })))
  });
  app.mount(host);
  return {
    el: host,
    getValue: () => value,
    focus: () => host.querySelector("input")?.focus(),
    destroy: () => app.unmount()
  };
}
```
