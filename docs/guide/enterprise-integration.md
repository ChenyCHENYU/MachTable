# 企业级项目接入手册

本文面向 0.40.x 的 B 端项目接入。先直接使用组件和已有工作流，再按实际需要增加统一约定；不要求先写配置文件或二次封装表格。

## 1. 接入前决策

先按页面形态选择数据模型：

| 场景 | 推荐方案 |
| --- | --- |
| 普通后台列表、查询表单、服务端分页 | 适配包 `/workflows` 的 `useMachTableQuery()` |
| 小到中型本地数据、复杂前端交互 | `rowData` + 本地排序过滤 |
| 连续向下加载的日志/动态 | 默认 `datasourceMode: "sequential"` |
| 百万级、滚动条任意跳转 | `datasourceMode: "block"` + 已知总量 |
| 组织、目录、物料分类 | `treeData` + `loadTreeChildren` |
| 同页多张本地小明细表 | `preset="detail"`，内容高度与 330px 表体上限已内置 |

不要把服务端分页、无限追加、随机块和懒加载树混在同一个实例中。优先选择满足需求的最小模型。

## 2. 安装与版本锁定

业务只安装一个框架适配包：

```bash
pnpm add @agile-team/mach-table-vue@^0.40.0
# 或
pnpm add @agile-team/mach-table-react@^0.40.0
```

适配包自动安装匹配的 Core。Vue 项目只需提供 `vue >= 3.2`；React 项目提供 `react/react-dom >= 18`。

生产项目建议：

- 提交 lockfile。
- 升级 minor 前阅读 [升级指南](/guide/upgrading)和各包 Changelog。
- 在预发布环境跑关键表格的业务回归与浏览器矩阵。
- 主题 CSS 只在应用入口导入一次。

## 3. 按业务组织代码

```text
src/
├─ api/orders.ts              # 使用项目既有 HTTP 客户端，必要时转换响应
├─ views/orders/
│  ├─ columns.ts              # 业务列、显示与校验
│  └─ OrdersPage.vue|tsx      # 搜索、表格和业务操作的组合
├─ config/mach-table.config.ts # 可选：只有项目统一差异才需要
└─ main.ts|tsx
```

组件已提供主题、加载/空态、分页与配置覆盖。使用 `<MachTable>` 组合项目已有搜索、表单、弹窗和按钮即可；不必再造 `AppTable` 来转发一遍全部参数。

## 4. 默认场景与可选统一约定

Vue/React 不传 `preset` 就是 `list`，主表只传列和数据；小明细只加 `preset="detail"`，同页可以并排多张。场景不根据行数猜测，不会因为异步加载先返回零行而改变模式。

```vue
<MachTable :column-defs="orderColumns" :row-data="orders" row-key="id" />
<MachTable preset="detail" :column-defs="materialColumns" :row-data="basketA" row-key="id" />
<MachTable preset="detail" :column-defs="materialColumns" :row-data="basketB" row-key="id" />
```

主表默认保留序号、分页、筛选、列设置与列宽调整，不自动添加复选框。明细保留序号，默认纯文字表头、只读、不分页，按内容收起，表体超过 330px 后虚拟滚动。业务列的 `editable: true` 或单表 props 可覆盖默认行为；只读不承担权限校验。

同项目希望统一密度、主题或明细高度时，再配置一次：

```ts
import { createMachTablePreset, defineMachTableConfig } from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: { theme: "auto", size: "compact", stripedRows: true },
  presets: {
    detail: createMachTablePreset("detail", { maxBodyHeight: 240 })
  }
});
```

React 使用 `-react` 包的同名 API。已有项目的同名自定义 preset 完整优先；需要继承内置场景时使用上面的 composer，不会把一份旧自定义预设悄悄变为另一套行为。

Vue 可直接 `app.use(MachTablePlugin)`，有统一约定才传第二个配置参数。React 可以直接使用组件，有统一约定才增加 `MachTableProvider`。公共 defaults、选中的场景和单表 props 从低到高覆盖；主题、密度、斑马纹、边框和宽度布局独立于场景。全局 `defaultPreset: false` 或单表 `preset={false}` 可退出默认场景，Vue 对应 `:preset="false"`。

数据、列、请求状态、初始状态和持久化身份属于表格实例，不进入公共 defaults/preset。完整配置边界见[配置中心](/guide/configuration)。

## 5. 稳定行身份

生产实例必须提供稳定、唯一的 `rowKey`：

```ts
rowKey: "id"
rowKey: "identity.businessId"
rowKey: (row) => `${row.tenantId}:${row.orderId}`
```

不要使用展示索引、随机数或会被编辑的普通字段。稳定 ID 影响：

- 增量事务与选择保持。
- 编辑脏数据、撤销/重做和冲突定位。
- 树、分组、详情展开。
- 无限/随机块加载后的跨块状态。
- GridState 的选择与展开恢复。

## 6. 业务列独立维护

```ts
// views/orders/columns.ts
import {
  defineColumns,
  rowActionsColumn,
  type ColDef
} from "@agile-team/mach-table-vue";

export const orderColumns = defineColumns<Order>([
  { field: "orderNo", headerName: "订单号", width: 150, pinned: "left" },
  { field: "customerName", headerName: "客户", minWidth: 180, flex: 1, filter: "text" },
  { field: "amount", headerName: "金额", type: "money", editable: canEditAmount },
  { field: "status", headerName: "状态", type: "status" },
  rowActionsColumn({
    onView: ({ data }) => openOrderDetail(data),
    onEdit: permissions.can("order.edit") ? openEdit : undefined,
    onDelete: permissions.can("order.delete") ? remove : undefined,
    overflow: "drawer",
    extraActions: domainActions
  })
]);
```

高频查看/编辑/删除使用内置图标，详情弹窗由项目的 `openOrderDetail` 提供；更多动作进入菜单或抽屉。`type: "money"` 等语义列需在项目配置中注册 `createBusinessColumnTypes()`；无统一列类型时直接使用普通字段和通用 formatter。

前端可见性不是安全边界，后端必须再次校验权限。

## 7. Vue 标准远程页面

假定项目的 `getOrderPageApi` 已返回 `{ rows, total }`；协议不同只在接口层转换一次。

```vue
<script setup lang="ts">
import { reactive } from "vue";
import { MachTable } from "@agile-team/mach-table-vue";
import { useMachTableQuery } from "@agile-team/mach-table-vue/workflows";
import { getOrderPageApi } from "@/api/orders";
import { orderColumns } from "./columns";

const filters = reactive({ keyword: "" });
const query = useMachTableQuery({ query: filters, rowKey: "id", request: getOrderPageApi });
const { bindings } = query;
</script>

<template>
  <div style="height: 560px">
    <MachTable v-bind="bindings" :column-defs="orderColumns" />
  </div>
</template>
```

搜索表单直接修改 `filters`；需要“点查询后提交”时再设 `mode: "manual"`，按钮调用 `query.reload({ resetPage: true })`。表格内置分页和 Overlay 直接工作，不重复维护 loading、分页状态或空态模板。

## 8. React 标准远程页面

```tsx
import { MachTable } from "@agile-team/mach-table-react";
import { useMachTableQuery } from "@agile-team/mach-table-react/workflows";
import { getOrderPageApi } from "@/api/orders";
import { orderColumns } from "./columns";

export function OrdersPage({ filters }: { filters: OrderFilters }) {
  const query = useMachTableQuery({ query: filters, queryKey: filters, rowKey: "id", request: getOrderPageApi });
  return <div style={{ height: 560 }}>
    <MachTable columnDefs={orderColumns} {...query.bindings} />
  </div>;
}
```

React 的 query 对象应保持稳定引用，或用 `queryKey` 明确请求条件变化。已有复杂的编辑、选择和工具栏组合，再使用 `useMachTableController`；它复用同一套查询/编辑工作流，无需增加项目自己的表格状态机。

## 9. 远程查询协议

`useMachTableQuery` 的请求收到完整且可取消的参数。以下假定项目 HTTP 客户端直接返回 `{ records, total }`；按真实返回结构解包，不把任意服务端响应当成同一种 envelope：

```ts
async function page(params: MachTablePageRequest<OrderFilters>) {
  const response = await http.post("/orders/page", {
    page: params.page,
    pageSize: params.pageSize,
    query: params.query,
    sort: params.sortModel,
    filter: params.filterModel,
    advancedFilter: params.advancedFilterModel,
    keyword: params.quickFilterText
  }, { signal: params.signal });

  return { rows: response.records, total: response.total };
}
```

约定：

- 把 `signal` 传给 HTTP 客户端。
- 返回 `rows` 数组与非负有限 `total`。
- 服务端把列 ID 映射到白名单字段，不能直接拼接 SQL。
- 排序、过滤和高级 AST 必须在服务端做深度、数量、操作符和字段白名单校验。
- `mode: "manual"` 用于“点击查询”；`auto` 用于实时筛选。
- `keepPreviousData` 减少分页闪烁，错误时保留可重试界面。

## 10. 编辑与保存闭环

单元格模式适合局部快速修改；`fullRow` 适合跨字段规则和显式确认。

```ts
const result = await table.api.value!.editing.save(async (changes) => {
  const response = await orderApi.saveBatch(changes);
  return {
    savedRowIds: response.savedIds,
    failures: response.validationErrors,
    conflicts: response.versionConflicts
  };
});

if (result.conflicts.length) {
  // 由业务决定接受服务端值还是保留本地值后重试。
  editing.resolveConflict(result.conflicts[0].rowId, "keepLocal");
}
```

请求开始时 Core 固定本次变更快照。请求期间产生的新编辑不会被旧响应误标记为已保存。`useMachTableEditing()` 额外提供：

- `dirty`、`changes`、`dirtyRowIds`。
- `saving`、`saveError`、`lastSaveResult`。
- `failedRowIds`、`reveal()`、`resolveConflict()`。
- `rollback()`、`markSaved()` 和离页提醒。

## 11. 状态与列宽记忆

适配器默认 `list` 已开启列宽交互，`detail` 关闭；Core 裸 `createGrid()` 保留原来的低层默认。持久化只有一个配置入口，不配置就不会写存储：

```ts
const stateKey = `${appId}:${tenantId}:${userId}:orders:v2`;

persistence: {
  key: stateKey,
  // 只要列偏好时使用；省略则保存完整工作区。
  sections: ["columns"],
  debounceMs: 160,
  store: enterpriseStateStore
}
```

自定义 store：

```ts
const enterpriseStateStore: GridStateStore = {
  async load(key) {
    return preferencesApi.get<GridState>(key);
  },
  async save(key, state) {
    await preferencesApi.put(key, state);
  },
  async clear(key) {
    await preferencesApi.remove(key);
  }
};
```

建议：

- key 包含应用、租户、用户、页面和业务 schema 版本。
- 删除/重命名关键列或改变行 ID 规则时升级 key 后缀。
- 用户会话状态与命名视图分开；命名视图通常不保存选择和展开。
- 不配置 `persistence` 时不会产生任何存储写入。

## 12. API 使用边界

页面代码只通过领域 API 操作：

```ts
api.rows.transact({ update: changedRows });
api.selection.clear();
api.columns.openWorkbench();
api.filtering.setQuickText(keyword);
await api.rows.reload({ signal });
api.view.scrollToRow(0, "top");
```

同一业务动作修改多个领域时使用 `batch()`：

```ts
api.batch((grid) => {
  grid.filtering.setModel(null);
  grid.sorting.setModel(null);
  grid.pagination.setPage(1);
});
```

不要导入内部 service/class，不要保存 RowNode 作为长期业务状态，也不要从 DOM 反推表格数据。

## 13. 错误、监控和诊断

至少采集：

- `gridError` 的 `code`、`source` 和异常。
- 远程请求耗时、取消率、失败率与返回行数。
- 编辑保存的失败/冲突数量。
- 可抽样的 `api.diagnostics.getPerformance()`。

```ts
const performance = api.diagnostics.getPerformance();
telemetry.gauge("grid.render.p95", performance.p95RenderMs);
```

诊断快照用于排错和测试，不作为业务真相源。

## 14. 安全基线

- Overlay 字符串默认按文本渲染；只有可信静态 HTML 才开启 `allowUnsafeOverlayHtml`。
- CSV 导出保持默认公式注入保护。
- 服务端对排序/过滤字段和操作符做白名单。
- 操作列权限同时在后端校验。
- 远程错误不要直接显示内部堆栈、SQL 或敏感响应。
- 不把访问令牌写入表格状态、列定义或持久化 key。

## 15. 测试策略

### 单元/组件测试

- 配置预设是否按预期覆盖。
- 列定义中权限、formatter、validator 和 action。
- 请求取消与过期响应不覆盖新数据。
- 部分保存、冲突、回滚和离页提醒。
- `persistence.sections` 只向 store 写入并只恢复允许的区段，敏感选择/筛选状态不会越界留存。

### E2E

- 键盘导航、选择、编辑提交/取消。
- 列宽拖动、双击自动宽度、刷新后恢复。
- 查询、分页、错误重试和跨页选择。
- 大数据连续滚动与多次进入/离开路由无泄漏。
- Chromium、Firefox、WebKit 关键流程。

### 消费端构建

在业务 CI 中至少验证 TypeScript、Vue SFC/React JSX、生产 bundler 构建和包体积变化。

## 16. 上线检查清单

- [ ] 只安装一个框架适配包并锁定 lockfile
- [ ] 应用入口只引入一次样式
- [ ] 每个生产表格提供稳定 `rowKey`
- [ ] 主列表虚拟布局容器具有明确高度和 `min-height: 0`，小明细使用 `detail` 或明确高度策略
- [ ] 实例数据/状态未进入全局 defaults 或 preset
- [ ] 持久化 key 包含租户、用户、场景和 schema 版本
- [ ] 远程请求透传 AbortSignal，并校验返回结构
- [ ] 服务端白名单校验排序、过滤和高级 AST
- [ ] 编辑失败、冲突、回滚与离页流程已验收；改变列配置或场景前处理未提交草稿
- [ ] 权限在后端再次校验
- [ ] `gridError` 和核心请求指标进入监控
- [ ] 关键流程通过浏览器矩阵和路由反复挂载测试
- [ ] 已确认 MachTable 使用授权范围

## 17. 推荐渐进落地

1. 先选择一个典型 CRUD 列表接入组件和查询，按需要增加持久化与统一配置。
2. 验证设计系统、权限、监控和错误处理。
3. 只将实际重复的业务列、请求协议转换和公共差异沉淀到已有组合点。
4. 扩展到编辑、树、详情和大数据页面。
5. 用真实性能与业务证据决定是否启用 Worker 或随机块模型。

相关文档：[配置中心](/guide/configuration) · [GridApi](/api/grid-api) · [远程查询](/recipes/remote-query) · [编辑](/recipes/editing) · [质量门禁](/advanced/quality-gates)
