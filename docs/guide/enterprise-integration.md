# 企业级项目接入手册

本手册面向需要把 MachTable 纳入正式业务系统的前端团队，覆盖技术选型、安装、工程封装、数据接入、错误治理、安全、性能、测试和上线检查。只想快速体验可先阅读[快速开始](/guide/getting-started)。

## 1. 接入前决策

### 选择正确的包

| 项目类型 | 安装 |
| --- | --- |
| Vue 3 | `@agile-team/mach-table` + `@agile-team/mach-table-vue` |
| React 18+ | `@agile-team/mach-table` + `@agile-team/mach-table-react` |
| 原生 TS/JS、Web Component、其他框架 | `@agile-team/mach-table` |

Vue 和 React 适配器互相独立，框架依赖是 peer dependency。Vue 项目不会因为官方支持 React 而增加 React 代码。

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
pnpm add @agile-team/mach-table@^0.4.0 @agile-team/mach-table-vue@^0.4.0
```

React：

```bash
pnpm add @agile-team/mach-table@^0.4.0 @agile-team/mach-table-react@^0.4.0
```

npm / Yarn：

```bash
npm install @agile-team/mach-table@^0.4.0 @agile-team/mach-table-vue@^0.4.0
yarn add @agile-team/mach-table@^0.4.0 @agile-team/mach-table-vue@^0.4.0
```

三个 MachTable 包采用同版本联动。业务项目应让 Core 与适配器保持相同 minor 版本，并提交 lockfile。`0.x` 阶段升级 minor 前先看[升级指南](/guide/upgrading)。

### 私有镜像

企业 npm 镜像需要同步 `@agile-team` scope。示例 `.npmrc`：

```ini
@agile-team:registry=https://registry.npmjs.org/
```

认证令牌只能放在 CI Secret 或用户级 npm 配置，禁止提交到仓库。若公司镜像代理 npmjs，请把 registry 替换为内部地址。

## 3. 全局样式

每个应用只引入一次主题 CSS。推荐放在应用入口或全局样式入口：

```ts
import "@agile-team/mach-table/styles/mach-table.css";
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

```vue
<!-- components/AppDataGrid.vue -->
<script setup lang="ts" generic="TData extends object">
import { computed } from "vue";
import { MachTable } from "@agile-team/mach-table-vue";
import type { ColDef, GridOptions } from "@agile-team/mach-table";

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
import type { ColDef } from "@agile-team/mach-table";
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

```tsx
import { useMemo } from "react";
import { MachTable } from "@agile-team/mach-table-react";
import type { ColDef, GridOptions } from "@agile-team/mach-table";

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
| 只重画展示内容 | `api.refreshCells()` |
| 弹窗、Tab、折叠面板变为可见 | `api.refreshLayout()` |
| 无限模式刷新 | `await api.reload()` |

不要原地修改数组后期待框架自动识别。Vue 给 `rows.value` 新数组；React 更新 state 引用。频繁实时更新优先合并为批次事务。

## 8. 服务端数据

无限数据源接收排序、过滤、快速搜索、取消信号和成功/失败回调：

```ts
import type { GridDatasource } from "@agile-team/mach-table";

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

## 10. 安全要求

- Overlay 字符串默认按文本渲染，推荐传入 `HTMLElement` 工厂。
- 除非内容完全由代码静态控制，否则禁止启用 `allowUnsafeOverlayHtml`。
- 单元格富内容优先返回 DOM/框架组件，不要拼接用户输入为 HTML。
- CSV 默认启用公式注入保护；只有可信内部数据才能关闭 `protectFormulas`。
- npm token、后端地址和租户信息不得写入列定义或前端仓库。
- 自定义 renderer/editor 必须返回 `destroy`，用于卸载框架 root 和取消监听器。

严格 CSP 项目应评估应用现有 style 策略。MachTable 使用外部 CSS，并根据布局写入必要的行内尺寸样式；若 CSP 禁止所有 `style-src-attr`，需要在企业安全基线中配置相应策略。

## 11. 错误与监控

统一接入 `onGridError`：

```ts
onGridError: ({ error, source, context }) => {
  telemetry.captureException(error, {
    tags: { component: "MachTable", source },
    extra: context
  });
}
```

MachTable 会隔离用户事件、renderer、formatter、Feature、数据源和销毁阶段异常。不要因为已有隔离就忽略监控；错误事件是生产环境发现业务插件缺陷的主要入口。

## 12. 性能基线

- 列定义在 Vue 使用 `shallowRef`，React 使用 `useMemo`。
- 纯展示优先 `valueFormatter`，不要为每个文本格创建 Vue/React root。
- `rowBuffer` 保持默认值；只有真实测量后再调整。
- 自动列宽最多取样部分数据，但仍不应在高频流更新中反复调用。
- 10 万级数据优先无限模式，避免一次性下载和 JSON 解析。
- 使用浏览器 Performance 面板和仓库 `examples/bench` 评估真实列模型与 renderer。

详见[性能指南](/advanced/performance)。

## 13. 测试建议

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

## 14. 上线检查清单

- [ ] Core 与框架适配器版本一致并提交 lockfile
- [ ] 全局 CSS 只引入一次
- [ ] 容器在桌面、弹窗、Tab、全屏模式都有确定高度
- [ ] 所有生产表格提供稳定 `getRowId`
- [ ] 服务端数据源透传 `AbortSignal`
- [ ] `onGridError` 已接入监控
- [ ] 自定义 renderer/editor/detail 均提供清理逻辑
- [ ] 未对不可信内容开启 `allowUnsafeOverlayHtml`
- [ ] 大数据量使用无限模式并完成真实数据压测
- [ ] Chrome/Edge、Firefox、Safari 目标版本完成验收
- [ ] 列状态 key 包含结构版本
- [ ] 升级记录、回滚版本和负责人已进入发布单

遇到问题先查[排错手册](/guide/troubleshooting)，升级版本查[升级指南](/guide/upgrading)。
