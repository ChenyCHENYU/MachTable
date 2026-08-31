# 企业级项目接入手册

本文面向真实 B 端项目落地，覆盖依赖、目录、全局约定、页面封装、远程查询、编辑保存、状态、监控、测试和上线。示例以 `0.25.x` 为基线。

## 1. 接入前决策

先按页面形态选择数据模型：

| 场景 | 推荐方案 |
| --- | --- |
| 普通后台列表、查询表单、服务端分页 | 适配包 `/workflows` 的 `useMachTableQuery()` |
| 小到中型本地数据、复杂前端交互 | `rowData` + 本地排序过滤 |
| 连续向下加载的日志/动态 | 默认 `datasourceMode: "sequential"` |
| 百万级、滚动条任意跳转 | `datasourceMode: "block"` + 已知总量 |
| 组织、目录、物料分类 | `treeData` + `loadTreeChildren` |
| 小型详情表、无需虚拟滚动 | `domLayout: "autoHeight"` |

不要把服务端分页、无限追加、随机块和懒加载树混在同一个实例中。优先选择满足需求的最小模型。

## 2. 安装与版本锁定

业务只安装一个框架适配包：

```bash
pnpm add @agile-team/mach-table-vue@^0.25.0
# 或
pnpm add @agile-team/mach-table-react@^0.25.0
```

适配包自动安装匹配的 Core。Vue 项目只需提供 `vue >= 3.2`；React 项目提供 `react/react-dom >= 18`。

生产项目建议：

- 提交 lockfile。
- 升级 minor 前阅读 [升级指南](/guide/upgrading)和各包 Changelog。
- 在预发布环境跑关键表格的业务回归与浏览器矩阵。
- 主题 CSS 只在应用入口导入一次。

## 3. 推荐目录

```text
src/
├─ config/
│  └─ mach-table.config.ts       # 全局约定、预设、语义列
├─ components/table/
│  ├─ AppTable.vue|tsx           # 可选：组织级薄封装
│  ├─ table-errors.ts            # 错误与遥测映射
│  └─ table-permissions.ts       # 操作策略
├─ api/
│  └─ orders.ts                  # 服务端接口
├─ views/orders/
│  ├─ columns.ts                 # 业务列
│  ├─ OrdersPage.vue|tsx
│  └─ orders.types.ts
└─ main.ts|tsx
```

组织级封装应保持“薄”：统一容器、空状态、错误遥测和少量强约定即可。不要二次复制全部 `GridOptions`，也不要隐藏 `GridApi` 的领域结构。

## 4. 应用配置中心

```ts
// src/config/mach-table.config.ts
import {
  createBusinessColumnTypes,
  defineMachTableConfig,
  defineMachTablePreset
} from "@agile-team/mach-table-vue"; // React 项目改为 -react

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    theme: "auto",
    columnLayout: "fit",
    enableColumnResize: true,
    defaultColDef: {
      minWidth: 100,
      sortable: true,
      resizable: true,
      movable: true,
      filter: true
    },
    pagination: {
      pageSize: 20,
      pageSizeOptions: [20, 50, 100],
      showTotal: true,
      showPageSizeSelector: true
    },
    onGridError: ({ code, error, source }) => {
      telemetry.captureException(error, { tags: { code, source } });
    }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ stripedRows: true, columnMenu: true }),
    crud: defineMachTablePreset({
      rowSelection: "multiple",
      editType: "fullRow",
      enableRangeSelection: true,
      statusBar: true
    }),
    picker: defineMachTablePreset({ rowSelection: "multiple" })
  },
  columnTypes: createBusinessColumnTypes({
    locale: "zh-CN",
    currency: "CNY",
    timeZone: "Asia/Shanghai"
  }),
  onConfigWarning: (warning) => telemetry.captureMessage(warning.message)
});
```

实例数据、列、请求状态、初始状态和持久化身份不能放进 defaults/preset。严格配置会尽早报错，避免跨租户串状态。

Vue 安装：

```ts
app.use(MachTablePlugin, machTableConfig);
```

React 安装：

```tsx
<MachTableProvider config={machTableConfig}><App /></MachTableProvider>
```

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
  { field: "amount", headerName: "金额", type: "currency", editable: canEditAmount },
  { field: "status", headerName: "状态", type: "status" },
  rowActionsColumn({
    onView: ({ data }) => router.push(`/orders/${data.id}`),
    onEdit: permissions.can("order.edit") ? openEdit : undefined,
    onDelete: permissions.can("order.delete") ? remove : undefined,
    overflow: "drawer",
    actions: domainActions
  })
]);
```

高频查看/编辑/删除使用内置图标；更多动作进入菜单或抽屉。没有通用动作的页面可以只传 `actions`，不会出现空占位按钮。

前端可见性不是安全边界，后端必须再次校验权限。

## 7. Vue 页面模板

```vue
<script setup lang="ts">
import { MachTable } from "@agile-team/mach-table-vue";
import { useMachTableController } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { orderColumns } from "./columns";

const controller = useMachTableController<Order, OrderFilters>({
  query: {
    query: () => filters.value,
    rowKey: "id",
    request: orderApi.page,
    mode: "manual",
    keepPreviousData: true,
    selectionScope: "query"
  },
  editing: { guardBeforeUnload: true }
});
</script>

<template>
  <section class="orders-page">
    <MachTableToolbar
      v-model="controller.search.value"
      :api="controller.table.api.value"
      :commands="controller.commands"
      :loading="controller.busy.value"
      :selected-count="controller.selectedCount.value"
    />
    <div class="orders-page__grid">
      <MachTable
        :ref="controller.table.ref"
        preset="crud"
        :column-defs="orderColumns"
        v-bind="controller.bindings.value"
        :persistence="{ key: stateKey }"
      />
    </div>
  </section>
</template>

<style scoped>
.orders-page { min-height: 0; height: 100%; display: flex; flex-direction: column; }
.orders-page__grid { min-height: 0; flex: 1; }
</style>
```

## 8. React 页面模板

```tsx
import { useMemo } from "react";
import { MachTable } from "@agile-team/mach-table-react";
import { useMachTableController, useMachTableQuery } from "@agile-team/mach-table-react/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";

export function OrdersPage() {
  const columns = useMemo(() => createOrderColumns(actions), [actions]);
  const query = useMachTableQuery<Order, OrderFilters>({
    query: filters,
    queryKey: filters,
    rowKey: "id",
    request: orderApi.page,
    mode: "manual",
    keepPreviousData: true,
    selectionScope: "query"
  });
  const controller = useMachTableController<Order>({ query });

  return <section className="orders-page">
    <MachTableToolbar
      api={controller.table.api}
      commands={controller.commands}
      search={controller.search}
      onSearchChange={controller.setSearch}
      loading={controller.busy}
      selectedCount={controller.selectedCount}
    />
    <div className="orders-page__grid">
      <MachTable<Order>
        apiRef={controller.table.apiRef}
        preset="crud"
        columnDefs={columns}
        persistence={{ key: stateKey }}
        {...controller.bindings}
      />
    </div>
  </section>;
}
```

## 9. 远程查询协议

`useMachTableQuery` 的请求收到完整且可取消的参数：

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

  return { rows: response.items, total: response.total };
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

列宽交互默认关闭，应用配置可统一开启。持久化只有一个配置入口：

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
const snapshot = api.diagnostics.get();
telemetry.gauge("grid.render.p95", snapshot.performance.p95RenderMs, {
  gridId: snapshot.gridId,
  rows: snapshot.rowCount,
  columns: snapshot.columnCount
});
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
- [ ] 默认虚拟布局容器具有明确高度和 `min-height: 0`
- [ ] 实例数据/状态未进入全局 defaults 或 preset
- [ ] 持久化 key 包含租户、用户、场景和 schema 版本
- [ ] 远程请求透传 AbortSignal，并校验返回结构
- [ ] 服务端白名单校验排序、过滤和高级 AST
- [ ] 编辑失败、冲突、回滚与离页流程已验收
- [ ] 权限在后端再次校验
- [ ] `gridError` 和核心请求指标进入监控
- [ ] 关键流程通过浏览器矩阵和路由反复挂载测试
- [ ] 已确认 MachTable 使用授权范围

## 17. 推荐渐进落地

1. 先选择一个典型 CRUD 列表接入配置中心、查询与持久化。
2. 验证设计系统、权限、监控和错误处理。
3. 沉淀薄封装、列工厂和请求适配器。
4. 扩展到编辑、树、详情和大数据页面。
5. 用真实性能与业务证据决定是否启用 Worker 或随机块模型。

相关文档：[配置中心](/guide/configuration) · [GridApi](/api/grid-api) · [远程查询](/recipes/remote-query) · [编辑](/recipes/editing) · [质量门禁](/advanced/quality-gates)
