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
  // 同一渲染批次的 key 会合并；排队及加载中的同一 key 复用请求。
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

解析器具备批处理、在途去重、TTL、LRU、主动失效和销毁取消能力。`1` 与 `"1"` 是不同的键，标签可以是空字符串。加载器只需返回当前请求键的标签；未返回的键会按相同 TTL 缓存“缺失”，避免未知编码在每次渲染时重复请求。标签与缺失记录共用 `maxSize` 的 LRU 容量，`size` 包含两者；`ttlMs: 0` 表示直到主动失效或 LRU 淘汰才重新加载。请求失败不会缓存，可由下一次 `resolve()` 重试。

字典更新后执行 `departments.invalidate(keys)`，不传键则全部失效。命中的排队/在途查询立即以 `undefined` 收敛；之后调用 `resolve()` 会重新加载。旧响应不会回填失效键或覆盖新请求的结果；同批次其他键继续完成。整批等待均已失效时会中断其 `AbortSignal`，即使加载器忽略取消，其迟到响应也不会回写。加载器额外返回的未请求键不进入缓存；批量预置标签使用 `prime(entries)`。

`prime(entries)` 是显式更新：同时满足这些键的等待者，旧请求不再覆盖新标签。应用销毁时调用 `destroy()`，所有未完成查询以销毁错误拒绝，后续 `resolve()` 也拒绝，`prime()` 不会复活实例。`onError` 是观察回调；其同步抛错或 Promise 拒绝不会替换原请求错误，也不会阻止等待者收敛。

缓存实例应由应用按组织、租户和语言作用域持有。切换作用域时先失效旧请求，再接入新作用域的加载上下文；不要让两个同时活动的租户共用一个可变全局加载器。平台已有统一字典缓存时直接适配现有数据源，避免再叠一层缓存。

字典 renderer 只负责单元格展示，不会替业务选择复制、CSV 和 XLSX 的输出口径。编码、标签或码名输出由 `valueSerializer` 显式声明；远程标签在输出前准备好，同步 serializer 中不发请求。详见[字典输出策略](./column-values.md#字典输出策略)。

## 显式字典列策略

同一编码需要在屏幕、复制和文件中采用不同形式时，从可选 `/business` 入口使用 `createDictionaryColumn`。Core、Vue、React 包均提供同名子路径；默认入口不加载这些值策略。它只要求数据源提供同步 `get(key)`，可以直接消费上述解析器或平台已有 Provider，不加载远程数据，也不创建第二份缓存。

```ts
import { createDictionaryColumn } from "@agile-team/mach-table-vue/business";
import type { DictionaryEntry } from "@agile-team/mach-table-vue";

let departmentOptions: readonly DictionaryEntry<string>[] = [];
const departmentColumn: ColDef<Employee> = {
  field: "departmentId",
  headerName: "部门",
  ...createDictionaryColumn(departments, {
    options: () => departmentOptions,
    display: "label",
    output: { clipboard: "label", csv: "code-label", xlsx: "code" }
  })
};

// 以同一作用域的新快照替换数组，反向解析索引随引用变化更新；不要原地修改旧数组。
departmentOptions = nextDepartmentOptions;
departments.prime(departmentOptions);
api.view.refreshCells();
```

`display` 支持 `code`、`label`、`code-label`（例如 `D01 · 生产部`），默认 `label`；未配置的输出通道保留原编码及类型。`valueParser` 优先识别原始编码，再识别唯一标签或码名。数字 `1` 与字符串 `"1"` 不混同，重复标签或标签与码名冲突时报告歧义错误，未知编码及 `null`、`undefined`、空字符串保留原值，是否允许提交由列 `validate` 决定。反向索引每个不可变选项快照只建立一次，单元格不会扫描整个字典。

Provider 或选项快照负责历史停用码、组织和语言的范围。只提供 `get` 而不提供 `options` 时，原码仍可输入，但不进行标签反向匹配；大型客户或物料应使用分页 Lookup。异步标签先通过现有 Provider 预热，再刷新或导出；这些列回调同步执行，不发请求。页面仍可覆盖返回的任意列回调。

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
