# 企业级项目接入手册

本手册面向需要把 MachTable 纳入正式业务系统的前端团队，覆盖技术选型、安装、工程封装、数据接入、错误治理、安全、性能、测试和上线检查。只想快速体验可先阅读[快速开始](/guide/getting-started)。

## 1. 接入前决策

### 选择正确的包

| 项目类型 | 安装 |
| --- | --- |
| Vue 3 | `@agile-team/mach-table-vue` |
| React 18+ | `@agile-team/mach-table-react` |
| 原生 TS/JS、Web Component、其他框架 | `@agile-team/mach-table` |

Vue 和 React 适配器互相独立，并自动安装、重导出匹配版本的 Core；宿主框架仍是 peer dependency。Vue 项目不会因为官方支持 React 而增加 React 代码。

### 数据模式

| 数据规模与场景 | 推荐方式 |
| --- | --- |
| 数百到数万条，数据已在浏览器 | `rowData`，使用客户端排序和过滤 |
| 常规后台接口分页 | `rowData` + 内置 `pagination`，接口返回一页时由业务层控制请求 |
| 数据量大、连续滚动、服务端排序过滤 | `datasource` 无限模式 |
| 树形、分组、聚合需要服务端下推 | 先确认业务模型；当前版本不提供完整 SSRM |

不要把百万行一次性下载到浏览器。虚拟化降低 DOM 成本，不会降低网络、解析和内存中的原始数据成本。

## 2. 安装与锁定版本

Vue：

```bash
pnpm add @agile-team/mach-table-vue@^0.9.1
```

React：

```bash
pnpm add @agile-team/mach-table-react@^0.9.1
```

npm / Yarn：

```bash
npm install @agile-team/mach-table-vue@^0.9.1
yarn add @agile-team/mach-table-vue@^0.9.1
```

三个 MachTable 包采用同版本联动。适配器会锁定匹配版本的 Core，业务项目只需升级适配器并提交 lockfile。`0.x` 阶段升级 minor 前先看[升级指南](/guide/upgrading)。

### 私有镜像

企业 npm 镜像需要同步 `@agile-team` scope。示例 `.npmrc`：

```ini
@agile-team:registry=https://registry.npmjs.org/
```

认证令牌只能放在 CI Secret 或用户级 npm 配置，禁止提交到仓库。若公司镜像代理 npmjs，请把 registry 替换为内部地址。

## 3. 全局样式

每个应用只引入一次主题 CSS。推荐放在应用入口或全局样式入口，并使用所属框架的单包入口：

```ts
// Vue
import "@agile-team/mach-table-vue/styles.css";

// React
import "@agile-team/mach-table-react/styles.css";
```

表格容器必须拥有可计算高度：

```css
.orders-grid {
  height: calc(100vh - 196px);
  min-height: 360px;
}
```

只有 `height: 100%` 而父级没有高度时，表格不会显示。这是接入时最常见的问题。

## 4. Vue 3 标准封装

建议在业务组件库中封装统一入口，集中默认配置、错误上报和主题策略。

### 注入策略

| 项目特征 | 推荐模式 | 原因 |
| --- | --- | --- |
| 少量路由使用表格 | 页面或业务封装内局部导入 | 随路由自然分包，边界最清楚 |
| 大部分页面使用表格 | `app.use(MachTablePlugin)` | 启动后任意模板直接使用 |
| 大型中后台、低代码平台 | `app.use(AsyncMachTablePlugin)` | 全局可用，同时首次渲染才加载 Core |

大型平台建议把配置单独维护，入口只负责安装。完整字段和覆盖规则见[配置中心](/guide/configuration)。

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig } from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    pagination: false,
    defaultColDef: { minWidth: 100, sortable: true, resizable: true, filter: true },
    onGridError: ({ code, error, source, context }) => {
      telemetry.captureException(error, { tags: { code, source }, extra: context });
    }
  }
});
```

```ts
// main.ts
import { createApp } from "vue";
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";
import "@agile-team/mach-table-vue/styles.css";
import App from "./App.vue";
import machTableConfig from "@/config/mach-table.config";

const app = createApp(App);
app.use(AsyncMachTablePlugin, machTableConfig);
app.mount("#app");

// 可在权限菜单 hover 或 requestIdleCallback 中预取。
void preloadMachTable();
```

配置中心解决大多数统一配置，路由布局可用响应式 `provideMachTableConfig` 继续叠加。只有需要固定审计字段、权限列或业务协议转换时才封装 `AppDataGrid`，避免为了重复默认值制造无意义包装层。

```vue
<!-- components/AppDataGrid.vue -->
<script setup lang="ts" generic="TData extends object">
import { computed } from "vue";
import { MachTable, type ColDef, type GridOptions } from "@agile-team/mach-table-vue";

const props = defineProps<{
  rows: TData[];
  columns: ColDef<TData>[];
  loading?: boolean;
  getRowId: NonNullable<GridOptions<TData>["getRowId"]>;
}>();

const defaults = computed(() => ({
  defaultColDef: { minWidth: 100, sortable: true, resizable: true },
  rowSelection: "multiple" as const,
  size: "compact" as const,
  stripedRows: true,
  columnMenu: true,
  onGridError: (event: { error: unknown; source: string; context?: Record<string, unknown> }) => {
    // 替换为企业监控平台：Sentry、OpenTelemetry 或内部日志 SDK。
    console.error("[grid]", event.source, event.error, event.context);
  }
}));
</script>

<template>
  <MachTable
    v-bind="defaults"
    :column-defs="columns"
    :row-data="rows"
    :loading="loading"
    :get-row-id="getRowId"
  />
</template>
```

业务页面：

```vue
<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import type { ColDef } from "@agile-team/mach-table-vue";
import AppDataGrid from "@/components/AppDataGrid.vue";

interface Order { id: string; customer: string; amount: number; status: string }

const rows = ref<Order[]>([]);
const loading = ref(false);
const columns = shallowRef<ColDef<Order>[]>([
  { field: "id", headerName: "订单号", width: 140, pinned: "left" },
  { field: "customer", headerName: "客户", flex: 1, filter: "text" },
  { field: "amount", headerName: "金额", width: 140, filter: "number" },
  { field: "status", headerName: "状态", width: 120, filter: "set" }
]);

onMounted(async () => {
  loading.value = true;
  try {
    rows.value = await orderService.list();
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <AppDataGrid
    class="orders-grid"
    :rows="rows"
    :columns="columns"
    :loading="loading"
    :get-row-id="({ data }) => data.id"
  />
</template>
```

适配器会在组件卸载时自动 `destroy()`。需要导出、选中或命令式操作时使用 [`useMachTable`](/guide/vue#usemachtable-组合式-api-推荐)。

## 5. React 标准封装

React 项目不使用全局组件注册。路由本身已懒加载时，在路由组件内正常 import；需要把表格从页面 chunk 继续拆分时使用标准懒加载：

```tsx
import { lazy, Suspense } from "react";

const LazyMachTable = lazy(() => import("@agile-team/mach-table-react"));

export function DeferredGrid() {
  return (
    <Suspense fallback={<div>正在加载表格...</div>}>
      <LazyMachTable columnDefs={columns} rowData={rows} />
    </Suspense>
  );
}
```

```tsx
import { useMemo } from "react";
import { MachTable, MachTableProvider, type ColDef, type GridOptions } from "@agile-team/mach-table-react";

type AppDataGridProps<TData> = {
  rows: TData[];
  columns: ColDef<TData>[];
  loading?: boolean;
  getRowId: NonNullable<GridOptions<TData>["getRowId"]>;
};

export function AppDataGrid<TData extends object>(props: AppDataGridProps<TData>) {
  const defaultColDef = useMemo<Partial<ColDef<TData>>>(() => ({
    minWidth: 100,
    sortable: true,
    resizable: true
  }), []);

  return (
    <MachTable<TData>
      rowData={props.rows}
      columnDefs={props.columns}
      loading={props.loading}
      getRowId={props.getRowId}
      defaultColDef={defaultColDef}
      rowSelection="multiple"
      size="compact"
      stripedRows
      columnMenu
      onGridError={(event) => console.error("[grid]", event.source, event.error, event.context)}
    />
  );
}
```

列定义和对象型配置应使用 `useMemo` 保持引用稳定。组件支持 StrictMode，卸载会自动清理。命令式操作使用 [`useMachGrid`](/guide/react#usemachgrid-hook-推荐)。

在应用或路由根部集中默认值；单表 props 会覆盖 Provider：

```tsx
<MachTableProvider defaults={{
  size: "compact",
  pagination: false,
  defaultColDef: { sortable: true, resizable: true, filter: true },
  onGridError: ({ code, error }) => telemetry.captureException(error, { tags: { code } })
}}>
  <OrdersRoutes />
</MachTableProvider>
```

## 6. 稳定行 ID

正式项目必须提供业务稳定且唯一的 `getRowId`：

```ts
getRowId: ({ data }) => data.id
```

不要使用当前数组下标、随机数或会变化的展示字段。稳定 ID 用于：

- 全量刷新后保持选择；
- 增删改事务定位；
- 树节点、明细行和无限模式缓存；
- 错误上下文与自动化测试定位。

开发和测试环境不要设置 `suppressWarnings`，这样重复 ID、重复列 ID 和不合法组合会尽早暴露。

## 7. 更新数据

| 操作 | 方式 |
| --- | --- |
| 接口返回全量新列表 | 更新 `rowData` / `api.setRowData(rows)` |
| 单行或少量增删改 | `api.applyTransaction({ add, update, remove })` |
| WebSocket / 高频流更新 | `await api.applyTransactionAsync(...)`；同一时间窗只刷新一次管线 |
| 只重画展示内容 | `api.refreshCells()` |
| 弹窗、Tab、折叠面板变为可见 | `api.refreshLayout()` |
| 无限模式刷新 | `await api.reload()` |

不要原地修改数组后期待框架自动识别。Vue 给 `rows.value` 新数组；React 更新 state 引用。高频实时更新使用 `applyTransactionAsync`，默认在 16ms 时间窗内按调用顺序合并；需要立即落地时调用 `flushAsyncTransactions()`。

## 8. 服务端数据

无限数据源接收排序、过滤、快速搜索、取消信号和成功/失败回调：

```ts
// React 项目将包名替换为 @agile-team/mach-table-react。
import type { GridDatasource } from "@agile-team/mach-table-vue";

const datasource: GridDatasource<Order> = {
  async getRows(params) {
    try {
      const result = await orderService.query({
        offset: params.startRow,
        limit: params.endRow - params.startRow,
        sort: params.sortModel,
        filter: params.filterModel,
        keyword: params.quickFilterText,
        signal: params.signal
      });
      params.onSuccess(result.rows, result.total);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") params.fail(error);
    }
  }
};
```

`AbortSignal` 必须传给 HTTP 客户端。排序或过滤变化时旧请求会被取消，忽略信号会浪费网络并增加竞态风险。完整协议见[无限滚动](/recipes/infinite-scroll)。

```ts
const remoteDefaults = {
  datasource,
  blockSize: 100,
  datasourceRetryCount: 2,
  datasourceRetryDelay: 300
};
```

请求失败后按基础延迟指数退避（最长 30 秒）；仅重试耗尽后发出 `DATA_SOURCE_ERROR`。`reload()`、排序/过滤变化和组件卸载都会取消当前请求及待执行重试。

## 9. 列状态持久化

单机应用只需设置带版本的 key：

```ts
columnStateKey: "orders-v1"
```

多设备或多租户系统使用后端存储：

```ts
columnStateStore: {
  load: (key) => preferencesApi.loadGridState({ key, userId, tenantId }),
  save: (key, state) => preferencesApi.saveGridState({ key, state, userId, tenantId })
}
```

列结构发生不兼容变化时升级 key，例如 `orders-v1` → `orders-v2`，不要让旧状态污染新列结构。

## 10. 全量视图状态

`columnStateKey` 只负责列偏好。需要保存工作台、页签或路由快照时使用版本化 `GridState`，它同时包含列、排序、过滤、快速搜索、分页、选择和展开状态：

```ts
const snapshot = api.getState();
sessionStorage.setItem("orders-grid", JSON.stringify(snapshot));

const restored = JSON.parse(sessionStorage.getItem("orders-grid") ?? "null");
if (restored) api.applyState(restored, { emitEvents: false });
```

首屏也可直接传 `initialState`，避免先渲染默认视图再跳变。状态对象带 `version`；业务持久化层仍应给自己的 schema 加版本并在列模型破坏性变化时迁移或丢弃旧快照。

## 11. 编辑、批量保存与并发安全

列级 `validate` 可返回字符串或 Promise。异步校验期间编辑器进入 `aria-busy`，失败保持编辑态；取消或卸载后迟到的响应不会写入数据。

```ts
{
  field: "orderNo",
  editable: true,
  validate: async (value) => await orderApi.exists(value)
    ? "订单号已存在"
    : true
}
```

录入型页面优先明确选择编辑模型：单字段快速修改使用默认 `editType: "cell"`，当前格自带对勾/取消；表单式业务使用 `editType: "fullRow"` 与 `rowActionsColumn`，整行草稿在所有字段校验通过前不会写入原数据：

```ts
import { rowActionsColumn } from "@agile-team/mach-table-vue"; // React 包同名导出

const options = {
  editType: "fullRow" as const,
  columnDefs: [
    { field: "customer", editable: true },
    { field: "amount", editable: true, cellEditor: "number", validate: validateAmount },
    rowActionsColumn({
      onView: ({ data }) => router.push(`/orders/${data.id}`),
      onDelete: ({ data }) => deleteOrder(data),
      overflow: "drawer",
      extraActions: businessActions
    })
  ]
};
```

整行提交形成一个撤销批次，Escape/取消立即丢弃草稿。操作列还支持 `overflow: "menu" | "drawer" | "inline"`；没有查看/编辑/删除的业务表直接使用 `actionsColumn({ actions })`，不会注入默认动作。

涉及日期区间、额度联动、字段组合唯一性等规则时使用 `rowEditValidator({ values, changes, data })`。它支持 Promise，并可返回 `{ [colId]: message }` 把错误定位到一个或多个具体编辑器。

所有成功写值自动进入脏数据集合。保存接口成功后由 `saveChanges` 精确确认该次快照；若请求期间用户继续编辑，新修改会保留，并把已保存值作为新的比较基线：

```ts
await api.saveChanges(async (changes) => {
  await orderApi.saveBatch(changes);
});

api.getDirtyRowIds();
api.getChanges();
api.rollbackChanges();
```

详见[编辑、校验与保存](/recipes/editing)。

## 12. 安全要求

- Overlay 字符串默认按文本渲染，推荐传入 `HTMLElement` 工厂。
- 除非内容完全由代码静态控制，否则禁止启用 `allowUnsafeOverlayHtml`。
- 单元格富内容优先返回 DOM/框架组件，不要拼接用户输入为 HTML。
- CSV 默认启用公式注入保护；只有可信内部数据才能关闭 `protectFormulas`。
- npm token、后端地址和租户信息不得写入列定义或前端仓库。
- 自定义 renderer/editor 必须返回 `destroy`，用于卸载框架 root 和取消监听器。

严格 CSP 项目应评估应用现有 style 策略。MachTable 使用外部 CSS，并根据布局写入必要的行内尺寸样式；若 CSP 禁止所有 `style-src-attr`，需要在企业安全基线中配置相应策略。

## 13. 错误与监控

统一接入 `onGridError`：

```ts
onGridError: ({ code, error, source, context }) => {
  telemetry.captureException(error, {
    tags: { component: "MachTable", code, source },
    extra: context
  });
}
```

MachTable 会隔离用户事件、renderer、formatter、Feature、数据源和销毁阶段异常。不要因为已有隔离就忽略监控；错误事件是生产环境发现业务插件缺陷的主要入口。

用户提交工单时可附加 `api.getDiagnostics()`：它只包含版本、行列/DOM 数量、加载与脏数据状态、最近 50 条结构化错误，不采集业务行内容。

## 14. 性能基线

- 列定义在 Vue 使用 `shallowRef`，React 使用 `useMemo`。
- 纯展示优先 `valueFormatter`，不要为每个文本格创建 Vue/React root。
- `rowBuffer` 保持默认值；只有真实测量后再调整。
- 自动列宽最多取样部分数据，但仍不应在高频流更新中反复调用。
- 10 万级数据优先无限模式，避免一次性下载和 JSON 解析。
- 使用浏览器 Performance 面板和仓库 `examples/bench` 评估真实列模型与 renderer。

详见[性能指南](/advanced/performance)。

## 15. 测试建议

组件测试至少覆盖：

- 有数据、空数据、加载和接口失败；
- 唯一行 ID 与事务更新；
- 选择、编辑校验、排序过滤；
- 路由切换或条件渲染后的卸载；
- 弹窗/Tab 打开后的 `refreshLayout()`。

端到端测试使用语义定位：

```ts
const grid = page.getByRole("grid");
await expect(grid).toBeVisible();
await grid.focus();
await expect(grid).toBeFocused();
```

不要依赖虚拟列表中当前不存在的远端行 DOM。需要定位业务行时先调用 API 滚动到目标位置。

## 16. 上线检查清单

- [ ] lockfile 中适配器只解析到一个匹配版本的 Core
- [ ] 全局 CSS 只引入一次
- [ ] 已按页面覆盖面选择局部、全局同步或全局异步策略
- [ ] 异步模式的 chunk 路径、CSP 与错误监控已在生产环境验证
- [ ] 容器在桌面、弹窗、Tab、全屏模式都有确定高度
- [ ] 所有生产表格提供稳定 `getRowId`
- [ ] 服务端数据源透传 `AbortSignal`
- [ ] 复杂编辑页已覆盖异步校验、保存失败与回滚
- [ ] 需要恢复工作区的页面已设计 `GridState` 版本迁移
- [ ] `onGridError` 已接入监控
- [ ] 自定义 renderer/editor/detail 均提供清理逻辑
- [ ] 未对不可信内容开启 `allowUnsafeOverlayHtml`
- [ ] 大数据量使用无限模式并完成真实数据压测
- [ ] Chrome/Edge、Firefox、Safari 目标版本完成验收
- [ ] 列状态 key 包含结构版本
- [ ] 升级记录、回滚版本和负责人已进入发布单

遇到问题先查[排错手册](/guide/troubleshooting)，升级版本查[升级指南](/guide/upgrading)。
