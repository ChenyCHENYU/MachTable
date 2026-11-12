# 远程查询、分页与跨页选择

`useMachTableQuery` 把 B 端列表最容易重复出错的部分收拢为一个类型安全控制器：请求分页、服务端排序/过滤、请求取消、乱序响应保护、加载/错误状态和跨页选择。

## 标准页面

下面假定项目接口 `getOrderPageApi` 已返回 `{ rows, total }`，并接收查询工作流的参数。已有接口形态不同时，在项目接口层转换一次，见下方请求协议。

```vue
<script setup lang="ts">
import { reactive } from "vue";
import { MachTable, type ColDef } from "@agile-team/mach-table-vue";
import { useMachTableQuery } from "@agile-team/mach-table-vue/workflows";
import { getOrderPageApi } from "@/api/orders";

interface Order { orderId: string; customer: string; amount: number }
const query = reactive({ keyword: "", status: "" });
const table = useMachTableQuery<Order, typeof query>({
  query,
  rowKey: "orderId",
  request: getOrderPageApi
});
const { bindings } = table;
const columns: ColDef<Order>[] = [
  { field: "orderId", headerName: "订单号", pinned: "left" },
  { field: "customer", headerName: "客户", flex: 1 },
  { field: "amount", headerName: "金额" }
];
</script>

<template>
  <div style="height: 560px">
    <MachTable v-bind="bindings" :column-defs="columns" />
  </div>
</template>
```

默认就是 `list`，无需声明场景、外部分页器、手动 `loading` 或请求序号。`bindings` 连接服务端分页、排序、过滤、加载和错误状态，表格继续使用内置 Overlay；标准页面不需要重复写 `#empty` 插槽。查询失败后可调用 `table.retry()`；内置错误文案不代表自动提供了重试按钮。

需要防抖时再加 `debounceMs`；需要不同页大小时再加 `pageSize/pageSizeOptions`。品牌化空态或就地重试按钮也按需提供：

```ts
useMachTableQuery({
  // ...query、rowKey、request
  emptyOverlay: "暂无订单",
  errorOverlay: ({ retry }) => createRequestErrorPanel({ onRetry: retry })
});
```

这里的 `createRequestErrorPanel` 是项目自己的 UI 函数。请求库、错误提示组件和业务权限都不植入表格包。若显式提供 `#error` 或 `#empty`，对应 slot 会按既有规则优先使用。

## 自动与手动查询

默认 `mode: "auto"`：业务 query、表格排序/过滤、快速搜索和分页变化会自动发起请求，适合即时筛选。

`mode: "manual"`：表单输入、排序、过滤和分页只更新待查询状态，不暗中请求；由查询按钮显式提交：

```ts
const table = useMachTableQuery({
  mode: "manual",
  query: form,
  rowKey: "id",
  request: orderApi.page
});

await table.reload({ resetPage: true });
```

改变手动查询的条件或页码会取消正在进行的旧请求，但不自动发起新请求，避免旧条件的响应覆盖待提交状态。

`retry()` 重放失败状态，`reset()` 清空表格排序、普通/高级/快速过滤后执行且只执行一次请求，`reload()` 始终显式请求。React 版本 API 等价；对象 query 应通过 `useMemo` 或 `queryKey` 声明变更依赖。

## 请求协议

每次请求都会收到当次分页、排序和过滤状态的独立快照，以及当前业务查询值：

```ts
interface MachTablePageRequest<TQuery> {
  page: number;
  pageSize: number;
  query: TQuery;
  sortModel: SortModel;
  filterModel: FilterModel;
  advancedFilterModel: AdvancedFilterModel | null;
  quickFilterText: string | null;
  signal: AbortSignal;
}
```

请求必须返回：

```ts
{ rows: TData[]; total: number }
```

例如项目的 `getOrdersApi` 实际返回 `{ records, total }`，则在接口层完成映射。下面只示意这个已声明的响应结构；如果 HTTP 客户端还包了一层 `data`，应在项目现有请求层按真实协议解包。

```ts
import type { MachTablePageRequest } from "@agile-team/mach-table-vue/workflows";

export async function getOrderPageApi(params: MachTablePageRequest<OrderFilters>) {
  const response = await getOrdersApi({
    ...params.query,
    page: params.page,
    size: params.pageSize,
    sort: params.sortModel,
    filters: params.filterModel,
    expression: params.advancedFilterModel,
    quickFilter: params.quickFilterText
  }, { signal: params.signal });
  return { rows: response.records, total: response.total };
}
```

应用已有接口若直接满足 `{ rows, total }`，直接传给 `request`，不再加一层转换。

新查询开始时会立即中止旧请求；即使后端或请求库忽略 `AbortSignal`，旧 `reload()` 的等待也会结束，晚到的旧响应不会覆盖新数据。接口层仍应使用 `signal` 释放实际网络或计算资源。返回结构、空行 ID 和重复行 ID 在接受结果前校验，错误进入 `table.error`，保留上一份有效结果与选择状态，可通过 `retry()` 恢复。

## 查询与刷新

- `query` 支持普通对象、ref 或 getter，深层字段变化自动回到第一页。
- `reload()` 刷新当前页。
- `reload({ resetPage: true })` 从第一页刷新。
- `retry()` 重试最后的当前状态。
- `reset()` 清空表格排序、普通/高级/快速过滤并回到第一页；业务查询表单由页面按自己的产品规则重置。
- `abort()` 主动取消请求，组件作用域销毁时也会自动取消。

## 删除后的末页回退

删除成功后直接 `await table.reload()`，不需要页面先判断“是否删了末页最后一条”。当返回的 `total` 说明当前页已越界时，工作流最多补查一次最后有效页，再一起更新页码、行和总数。中间空页不会触发 `onSuccess` 或清除页内选择；总数为零则直接显示第一页空态。

补查失败或总数再次缩小导致补查仍越界时，沿用错误与 `retry()`，保留上一份有效结果，不无限循环。补查和原请求共用取消边界；新查询、主动取消及卸载都能让旧结果失效。这依赖接口返回当前查询的准确总数，不代替服务端事务与权限校验。

## 跨页选择

`selectionScope: "preserve"` 按稳定 `rowKey` 保存已访问页面的选择：

```ts
table.selectedKeys.value; // 所有已选择主键
table.selectedRows.value; // 已加载过的对应业务对象
table.clearSelection();
```

需要复选框时，在业务列加入 `selectionColumn()`，并为表格声明 `rowSelection: "multiple"`；场景不会替业务开启多选。设置 `"page"` 时，接受新页后只保留该页仍存在的已选 ID，同页刷新保留相同 ID。百万级“全选当前查询”使用紧凑规则，不会把所有 ID 下载到浏览器：

```ts
const table = useMachTableQuery({
  // ...
  selectionScope: "query"
});

table.selectAllMatching();
table.selectionState.value;
// { mode: "allMatching", excludedKeys: [] }

// 用户取消两行后：
// { mode: "allMatching", excludedKeys: ["id-7", "id-19"] }
await orderApi.batchAction({ query, selection: table.selectionState.value });
```

普通跨页选择使用 `{ mode: "explicit", selectedKeys }`。`applySelectionState()` 可恢复两种状态。业务查询、列过滤或快速过滤变化时默认清空选择，避免把旧查询的规则误用于新数据；确有跨查询保留需求时可设 `clearSelectionOnQueryChange: false`。服务端必须再次按当前用户权限解析查询，不能信任前端提交的 ID 或规则。

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
