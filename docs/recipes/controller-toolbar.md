# 控制器与标准工具栏

0.14 把普通 B 端列表反复编写的 API 就绪、搜索、刷新、选择计数、编辑保存状态和错误聚合为一个控制器。标准工具栏只是可选视图层：可以整套使用、关闭单项能力，也可以只使用 `commands` 接入现有设计系统。

## Vue：全局注册，页面零组件导入

基础表格与工具栏使用独立入口，避免只用表格的页面携带工具栏代码：

```ts
// main.ts
import AsyncMachTablePlugin from "@agile-team/mach-table-vue/async";
import MachTableUiPlugin from "@agile-team/mach-table-vue/ui";
import "@agile-team/mach-table-vue/styles.css";
import machTableConfig from "@/config/mach-table.config";

app
  .use(AsyncMachTablePlugin, machTableConfig)
  .use(MachTableUiPlugin);
```

```vue
<script setup lang="ts">
import { useMachTableController } from "@agile-team/mach-table-vue/workflows";
import type { ColDef } from "@agile-team/mach-table-vue";

interface Order { id: string; customer: string; amount: number }
const controller = useMachTableController<Order>();
const columns: ColDef<Order>[] = [
  { field: "customer", flex: 1 },
  { field: "amount", type: "money" }
];
</script>

<template>
  <MachTableToolbar
    v-model="controller.search.value"
    :api="controller.table.api.value"
    :commands="controller.commands"
    :loading="controller.busy.value"
    :selected-count="controller.selectedCount.value"
    @clear-selection="controller.table.api.value?.selection.clear()"
  >
    <button @click="createOrder">新建订单</button>
  </MachTableToolbar>
  <div class="orders-grid">
    <MachTable
      :ref="controller.table.ref"
      preset="crud"
      :column-defs="columns"
      :row-data="rows"
      row-key="id"
      state-key="orders-list"
    />
  </div>
</template>

<style scoped>
.orders-grid { height: calc(100vh - 180px); min-height: 360px; }
</style>
```

只在一个路由使用工具栏时，可直接局部导入：

```ts
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
```

## React：Provider 配置 + 页面控制器

React 没有全局组件注册；`MachTableProvider` 负责应用/路由配置，普通 import 仍可由路由分包和 tree-shaking 优化。

```tsx
import { MachTable } from "@agile-team/mach-table-react";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";
import { useMachTableController } from "@agile-team/mach-table-react/workflows";

function OrdersPage({ rows }: { rows: Order[] }) {
  const controller = useMachTableController<Order>();
  return <>
    <MachTableToolbar<Order>
      api={controller.table.api}
      commands={controller.commands}
      search={controller.search}
      onSearchChange={controller.setSearch}
      loading={controller.busy}
      selectedCount={controller.selectedCount}
      onClearSelection={() => controller.table.apiRef.current?.selection.clear()}
      start={<button onClick={createOrder}>新建订单</button>}
    />
    <div style={{ height: 560 }}>
      <MachTable<Order>
        apiRef={controller.table.apiRef}
        preset="crud"
        columnDefs={columns}
        rowData={rows}
        rowKey="id"
        :persistence="{ key: 'tenant:user:orders-list' }"
      />
    </div>
  </>;
}
```

远程 React 页面先无条件调用 `useMachTableQuery`，再把结果传给控制器，符合 Hooks 规则：

```tsx
const query = useMachTableQuery<Order, OrderFilters>({
  query: filters,
  queryKey: filters,
  rowKey: "id",
  request: orderApi.page,
  mode: "manual"
});
const controller = useMachTableController<Order>({ query });

<MachTable apiRef={controller.table.apiRef} {...controller.bindings} />;
// 查询按钮：void controller.query?.reload({ resetPage: true })
```

对象形式的 React `query` 应由 `useMemo` 保持引用稳定，或提供 `queryKey` 明确控制自动查询依赖。

## 工具栏能力与覆盖

默认启用搜索、刷新、列工作台、密度和 CSV；撤销/重做与全屏默认关闭。通过 `features` 精确控制：

```ts
const features = {
  search: true,
  refresh: true,
  columns: true,
  density: false,
  export: false,
  undoRedo: true,
  fullscreen: true
};
```

工具栏不会替代业务操作区：Vue 使用 `start/default/end` 插槽，React 使用 `start/children/end`。如果项目已有 Toolbar，只消费 `controller.commands` 即可，命令层没有 Vue/React 依赖。

## 自动高度与持久化边界

- 默认 `domLayout: "normal"` 使用虚拟滚动，宿主容器必须有高度，适合大多数列表。
- `domLayout: "autoHeight"` 会渲染全部客户端行，只用于弹窗详情、打印预览和几十/几百行的小表；不能和 `datasource` 混用。
- `persistence` 自动保存指定区段或完整工作区。跨账号/多租户系统应把用户或租户维度放进 key，可通过 `store` 注入后端或 IndexedDB。
- `rowKey` 可以是字段路径或 `(row) => id`，必须保持稳定且全数据集唯一。

## 推荐页面颗粒度

页面只保留列、查询条件、请求函数和业务按钮；应用配置留在 `mach-table.config.ts`，通用行为留在 preset，数据表状态交给 controller/query/editing。这样既减少模板胶水，也没有隐藏请求和不可覆盖的全局魔法。
