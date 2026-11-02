# 业务字段与权限操作

MachTable 提供金额、日期等语义列和统一操作策略。外部选项的请求、翻译和缓存由项目插件持有，表格只消费普通列配置和同步值回调，不识别业务服务或注入协议。

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

## 由项目组合外部选项

外部服务由应用统一安装。页面通过项目自己的组合函数取得已准备的标签、选项和状态，再交给表格的通用列能力；MachTable 不注册数据服务，不读取 Provider，不创建缓存或在单元格内请求接口。

```ts
import type { ColDef } from "@agile-team/mach-table-vue";

// 示例数据由项目持有；实际项目可复用任何插件或接口的响应式快照。
const options = [{ value: "D01", label: "生产部" }];
const labels = new Map(options.map(option => [option.value, option.label]));
const label = (value: unknown) => labels.get(String(value)) ?? String(value ?? "");
const columns: ColDef<Employee>[] = [{
  field: "departmentId",
  headerName: "部门",
  valueFormatter: ({ value }) => label(value),
  valueSerializer: ({ value, target }) => target === "xlsx" ? value : label(value),
  cellEditor: "select",
  cellEditorParams: { options },
  filter: "set",
  filterOptions: options
}];
```

`valueFormatter` 只负责显示，`valueParser` 负责输入转换，`valueSerializer` 明确复制/CSV/XLSX 的输出口径。项目层处理原码类型、歧义输入与历史停用项；列回调同步纯读，不把标签写回原始模型。详见[列值策略](./column-values.md)。

外部标签更新后，由项目订阅调用 `api.view.refreshCells()`；选项或编辑参数变化时替换普通列配置。需要重新测量文字宽度时调用 `api.columns.autoSize(["departmentId"])`。加载、失败与重试通过页面现有状态区展示；导出前由项目等待同一查询和身份快照所需的数据准备完成。

## 显式语义合计

多币种销售明细、不同单位的生产数量不能不加区分地求和。`summarizeRows` 只聚合传入数据，使用侧显式声明 `scope`、指标及分组，结果可以交给既有 `summaryMethod` 或固定行，不改变它们的默认行为。

```ts
import { summarizeRows } from "@agile-team/mach-table-vue/business";

const summary = summarizeRows(visibleRows, {
  scope: "page",
  groupBy: row => JSON.stringify([row.currency, row.unit]),
  metrics: [
    { id: "amount", kind: "sum", value: row => row.amount },
    { id: "quantity", kind: "sum", value: row => row.quantity },
    { id: "lineCount", kind: "count" },
    { id: "completion", kind: "ratio", numerator: row => row.completed, denominator: row => row.planned },
    { id: "unitPrice", kind: "none" }
  ]
});

// 保留币种/单位分组标签；按当前行结构和 ColDef 补齐展示字段。
api.view.setPinnedRows("bottom", summary.groups.map(group => ({
  id: `summary:${group.key}`,
  name: `本页合计 ${group.key}`,
  ...group.values
})));
```

`count` 统计记录数，`none` 不生成该指标。`ratio` 先分别求分子总和与分母总和再相除，不能平均每行百分比。默认忽略数值字段中的 `null`、`undefined` 和空字符串，保留真实 `0`；零分母返回 `null`。未分组的空数据返回零合计、零条数及空比率；提供 `groupBy` 的空数据返回空分组。

默认数值策略只接受有限、绝对值不超过 `Number.MAX_SAFE_INTEGER` 的 `number`，并检查累计和除法溢出；数值字符串不会静默转换。它仍遵循 JavaScript 浮点语义，不承诺精确金额。已有 Decimal、定点整数或规范小数字符串算法可通过 `numeric: { zero, add, divide }` 接入；每个回调必须同步且不修改原行，单位、精度、舍入和自定义零分母策略归业务适配器，组件不内置 Decimal 引擎。

`scope` 只标记 `page`（本页）、`selected`（已选）或 `query`（查询范围）；`query` 不会自动取全量，也不能证明传入数据已完整。分页/无限数据源的全量合计由后端提供权威结果。调用方在行、选择或查询快照变化时重新计算，指标 ID 必须非空且唯一，不能用列的右对齐样式推断求和语义。

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
