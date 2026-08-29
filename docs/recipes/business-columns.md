# 业务字段、字典与权限操作

MachTable 把项目里最容易复制粘贴的金额、日期、字典和操作权限统一放到应用配置。页面只描述业务含义，不再重复 formatter、缓存、确认框和错误处理。

## 一次配置语义列

```ts
// src/plugins/mach-table.config.ts
import {
  createBusinessColumnTypes,
  defineMachTableConfig
} from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  columnTypes: createBusinessColumnTypes({
    locale: "zh-CN",
    currency: "CNY",
    timeZone: "Asia/Shanghai",
    emptyText: "—",
    invalidText: "数据异常"
  })
});
```

页面只需要：

```ts
const columns: ColDef<Order>[] = [
  { field: "amount", headerName: "金额", type: "money" },
  { field: "taxRate", headerName: "税率", type: "percent" },       // 0.13 -> 13%
  { field: "progress", headerName: "进度", type: "percentage" },  // 13 -> 13%
  { field: "createdAt", headerName: "创建时间", type: "datetime" },
  { field: "enabled", headerName: "启用", type: "boolean" },
  { field: "status", headerName: "状态", type: "status" }
];
```

内置类型包括 `text`、`number`、`integer`、`money`、`percent`、`percentage`、`date`、`datetime`、`boolean`、`status` 和 `link`。它们使用 `Intl`，不会在页面里固化币种和时区；具体列仍可覆盖任何属性。

## 异步字典只请求一次

```ts
import {
  createCachedDictionary,
  createDictionaryRenderer
} from "@agile-team/mach-table-vue";

const departments = createCachedDictionary<string>({
  // 同一渲染批次的 key 会合并；重复 key 只发一次。
  load: (keys, signal) => dictionaryApi.labels("department", keys, { signal }),
  ttlMs: 10 * 60_000,
  maxSize: 2_000,
  onError: (error, keys) => telemetry.captureException(error, { keys })
});

const columns: ColDef<Employee>[] = [{
  field: "departmentId",
  headerName: "部门",
  cellRenderer: createDictionaryRenderer(departments, { loadingText: "加载中…" })
}];
```

解析器具备批处理、并发去重、TTL、LRU、主动失效和销毁取消能力。字典更新后执行 `departments.invalidate(keys)`；应用级单例在应用销毁时调用 `destroy()`。

## 全局操作策略

```ts
export default defineMachTableConfig({
  defaults: {
    actionPolicy: {
      canAccess: ({ permissions }) => permissions.every(authStore.has),
      confirm: ({ message }) => dialog.confirm(message ?? "确认执行？"),
      onError: (error, { actionId, params }) => {
        telemetry.captureException(error, { actionId, rowId: params.node.id });
      }
    }
  }
});
```

具体表格声明动作即可：

```ts
rowActionsColumn<Order>({
  onView: ({ data }) => openDetail(data.id),
  onDelete: ({ data }) => orderApi.remove(data.id),
  permissions: {
    view: "order.read",
    edit: "order.update",
    delete: "order.delete"
  },
  confirmDelete: "删除后不可恢复，确认继续？",
  extraActions: [{
    id: "order.audit",
    label: "审核",
    permission: "order.audit",
    onClick: ({ data }) => audit(data.id)
  }]
});
```

`actionPolicy` 只负责界面裁剪和交互一致性，不能替代服务端鉴权。动作 Promise 执行期间自动进入 loading，失败统一进入 `onError`，避免产生未处理 Promise。
