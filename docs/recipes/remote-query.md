# 远程查询、分页与跨页选择

`useMachTableQuery` 把 B 端列表最容易重复出错的部分收拢为一个类型安全控制器：请求分页、服务端排序/过滤、请求取消、乱序响应保护、加载/错误状态和跨页选择。

## 标准页面

```vue
<script setup lang="ts">
import { reactive } from "vue";
import {
  selectionColumn,
  useMachTableQuery,
  type ColDef
} from "@agile-team/mach-table-vue";

interface Order {
  orderId: string;
  customer: string;
  amount: number;
}

const query = reactive({ keyword: "", status: "" });
const table = useMachTableQuery<Order, typeof query>({
  query,
  rowKey: "orderId",
  pageSize: 20,
  pageSizeOptions: [20, 50, 100, 200],
  debounceMs: 200,
  selectionScope: "preserve",
  request: async ({ page, pageSize, query, sortModel, filterModel, signal }) => {
    const response = await orderApi.page({
      ...query,
      page,
      size: pageSize,
      sort: sortModel,
      filters: filterModel
    }, { signal });
    return { rows: response.records, total: response.total };
  },
  onError: (error) => telemetry.captureException(error)
});

// 在模板中 v-bind 时先解构，Vue 会自动解包 computed。
const { bindings, error, retry } = table;

const columns: ColDef<Order>[] = [
  selectionColumn(),
  { field: "orderId", headerName: "订单号", pinned: "left" },
  { field: "customer", headerName: "客户", flex: 1 },
  { field: "amount", headerName: "金额", type: "money" }
];
</script>

<template>
  <MachTable preset="list" v-bind="bindings" :column-defs="columns">
    <template #empty>
      <AppError
        v-if="error"
        :error="error"
        @retry="retry"
      />
      <AppEmpty v-else description="暂无订单" />
    </template>
  </MachTable>
</template>
```

页面不再需要 `grid-ready`、`gridApi`、外部分页器、手动 `loading` 或请求序号。

## 请求协议

每次请求都会收到当次分页、排序和过滤状态的独立快照，以及当前业务查询值：

```ts
interface MachTablePageRequest<TQuery> {
  page: number;
  pageSize: number;
  query: TQuery;
  sortModel: SortModel;
  filterModel: FilterModel;
  quickFilterText: string | null;
  signal: AbortSignal;
}
```

请求必须返回：

```ts
{ rows: TData[]; total: number }
```

新查询开始时会立即中止旧请求；即使后端或请求库忽略 `AbortSignal`，晚到的旧响应也不会覆盖新数据。返回结构和 `rowKey` 在运行时校验，错误进入 `table.error`，不会制造未处理 Promise。

## 查询与刷新

- `query` 支持普通对象、ref 或 getter，深层字段变化自动回到第一页。
- `reload()` 刷新当前页。
- `reload({ resetPage: true })` 从第一页刷新。
- `retry()` 重试最后的当前状态。
- `reset()` 清空表格排序/过滤并回到第一页；业务查询表单由页面按自己的产品规则重置。
- `abort()` 主动取消请求，组件作用域销毁时也会自动取消。

## 跨页选择

`selectionScope: "preserve"` 按稳定 `rowKey` 保存已访问页面的选择：

```ts
table.selectedKeys.value; // 所有已选择主键
table.selectedRows.value; // 已加载过的对应业务对象
table.clearSelection();
```

设置 `"page"` 时，翻页后的新选择会替换上一页选择。百万级“服务端全选”需要后端查询令牌和排除列表，不应把所有 ID 下载到浏览器；该协议属于后续独立能力。

## Core 的受控服务端分页

不使用 Vue composable 时也可直接控制：

```ts
pagination: {
  mode: "server",
  page: 3,
  pageSize: 20,
  total: 1280
}
```

服务端模式不会再次切割 `rowData`，分页条使用 `total` 计算页数，并通过 `paginationChanged` 请求下一页。
