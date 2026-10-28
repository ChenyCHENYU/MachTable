<p align="center">
  <img src="./assets/mach-table-logo.svg" alt="MachTable Enterprise Data Grid" width="920" />
</p>

<p align="center">
  <strong>面向复杂 B 端业务的高性能 TypeScript 数据表格</strong><br />
  框架无关内核 · Vue 3 优先 · React 18+ 官方支持
</p>

<p align="center">
  <img src="https://img.shields.io/badge/source-0.34.0-2563eb" alt="Source version 0.34.0" />
  <a href="https://www.npmjs.com/package/@agile-team/mach-table"><img src="https://img.shields.io/npm/v/@agile-team/mach-table?label=npm&color=3178c6" alt="npm version" /></a>
  <a href="https://github.com/ChenyCHENYU/MachTable/actions/workflows/ci.yml"><img src="https://github.com/ChenyCHENYU/MachTable/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-authorization%20required-dc2626" alt="Authorization required" /></a>
  <img src="https://img.shields.io/badge/core%20runtime%20dependencies-0-14b8a6" alt="Zero core runtime dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-first-6366f1" alt="TypeScript first" />
</p>

<p align="center">
  <a href="./docs/guide/getting-started.md"><strong>快速开始</strong></a> ·
  <a href="./docs/guide/enterprise-integration.md"><strong>企业接入</strong></a> ·
  <a href="./docs/guide/scenarios.md">场景示例</a> ·
  <a href="./docs/guide/vue.md">Vue</a> ·
  <a href="./docs/guide/react.md">React</a> ·
  <a href="./docs/api/grid-options.md">API</a> ·
  <a href="./examples">示例</a> ·
  <a href="./LICENSING.md">授权说明</a>
</p>

---

## 为什么选择 MachTable

MachTable 为后台管理、工业台账、订单/工单、财务报表和低代码平台提供一套可组合的数据网格能力。它不追求堆叠相似 API，而是把高频复杂场景做成稳定、类型安全且可诊断的产品能力。

| 维度 | 已具备的能力 |
| --- | --- |
| 大数据 | 行列双虚拟化、行池复用、可变行高索引、随机访问远程块、LRU 与并发控制、可选 Worker |
| 数据模型 | 本地/服务端排序过滤、分页、无限滚动、树与懒加载、分组聚合、主从详情、固定行 |
| 远程导出 | 可序列化的筛选、排序、可见列与跨页选择快照，供业务服务端执行全量导出；本地 CSV/XLSX 继续处理已加载数据 |
| 编辑 | 单元格与原子整行编辑、对勾/取消、编辑/粘贴/清空/填充共用同步异步校验、脏数据、撤销重做、部分保存与冲突处理 |
| 交互 | 多选/范围选择、复制粘贴、填充柄、主题化行拖拽与条件整行颜色、列宽调整、列工作台、统一无闪烁下拉、上下文菜单、操作列 |
| 框架体验 | Vue 原生 slots、React renderer、全局/局部/异步接入、远程查询与编辑工作流 |
| 治理 | 分层配置、命名预设、配置来源解释、领域化 API、版本化状态、稳定错误码、诊断快照 |
| 安全 | CSV 公式注入防护、安全字段路径、Overlay 默认文本渲染、资源销毁与请求取消 |

服务端分页和无限数据源的全量导出使用 [`createRemoteExportRequest()`](./docs/recipes/remote-export.md) 固定请求范围，再由业务后端生成文件。原有 `api.io.exportCsv()`、可选 XLSX 扩展与工具栏行为不变。

## 安装：业务只装一个适配包

Vue 或 React 包会自动安装匹配的 Core，并重导出公共类型与核心能力；使用方不需要再手动安装第二个表格包。

```bash
# Vue 3
pnpm add @agile-team/mach-table-vue

# React 18+
pnpm add @agile-team/mach-table-react

# 仅原生 TypeScript/JavaScript
pnpm add @agile-team/mach-table
```

主题样式在应用入口只引入一次。

## 60 秒开始

### Vue 3

```vue
<script setup lang="ts">
import { h, ref } from "vue";
import { MachTable, defineVueColumns, indexColumn, selectionColumn, useMachTable, type MachTableVueProps } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";

interface Order { id: string; customer: string; amount: number }

const table = useMachTable<Order>();
const rows = ref<Order[]>([{ id: "SO-001", customer: "Acme", amount: 12800 }]);
const columns = defineVueColumns<Order>([
  selectionColumn(),
  indexColumn({ headerName: "序号" }),
  { field: "id", headerName: "订单号", width: 130, pinned: "left" },
  { field: "customer", headerName: "客户", flex: 1, editable: true, filter: "text" },
  { field: "amount", headerName: "金额", width: 140, filter: "number", render: (row) => h("strong", `¥${row.amount}`) }
]);
const tableConfig = {
  rowKey: "id",
  rowSelection: "multiple",
  enableColumnResize: true,
  persistence: { key: "orders:list" },
  stripedRows: true
} satisfies MachTableVueProps<Order>;
</script>

<template>
  <div style="height: 560px">
    <MachTable
      v-bind="tableConfig"
      :ref="table.ref"
      :column-defs="columns"
      :row-data="rows"
    />
  </div>
</template>
```

### React 18+

```tsx
import { useMemo } from "react";
import { MachTable, indexColumn, useMachTable, type ColDef } from "@agile-team/mach-table-react";
import "@agile-team/mach-table-react/styles.css";

interface Order { id: string; customer: string; amount: number }

export function OrdersPage({ rows }: { rows: Order[] }) {
  const table = useMachTable<Order>();
  const columns = useMemo<ColDef<Order>[]>(() => [
    indexColumn({ headerName: "序号" }),
    { field: "id", headerName: "订单号", width: 130, pinned: "left" },
    { field: "customer", headerName: "客户", flex: 1, editable: true },
    { field: "amount", headerName: "金额", width: 140, filter: "number" }
  ], []);

  return (
    <div style={{ height: 560 }}>
      <MachTable<Order>
        apiRef={table.apiRef}
        columnDefs={columns}
        rowData={rows}
        rowKey="id"
        enableColumnResize
        persistence={{ key: "orders:list" }}
      />
    </div>
  );
}
```

### 原生 TypeScript

```ts
import { createGrid, indexColumn } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, {
  columnDefs: [indexColumn({ headerName: "序号" }), { field: "name", headerName: "名称", flex: 1 }],
  rowData: [{ id: "1", name: "MachTable" }],
  rowKey: "id"
});

// Vue/React 适配器会自动销毁；原生接入由宿主在卸载时调用。
api.destroy();
```

> 默认虚拟布局要求容器具有明确高度。小型详情表可使用 `domLayout: "autoHeight"`，大表或远程无限数据源不要使用自动高度。

标准列表默认把 `indexColumn()` 放在第一列；存在 `selectionColumn()` 时序号紧随其后。启用行拖拽时，可在最左侧增加 `dragColumn()` 手柄。表头和单元格内容默认居中，业务列可用 `align: "left" | "right"`、`headerAlign` 单独覆盖。

## 行拖拽与条件整行颜色

Vue、React 和 Core 使用同一份配置。只需增加 `dragColumn()` 和可选 `rowStyleRules`，不必逐列编写 renderer 或样式：

```ts
import { dragColumn, type GridOptions } from "@agile-team/mach-table-vue";

interface Plan { id: string; name: string; status: string; issued: boolean }
const options: GridOptions<Plan> = {
  rowKey: "id",
  columnDefs: [dragColumn(), { field: "name" }, { field: "status" }],
  rowStyleRules: [
    { when: ({ data }) => data.status === "S1B", tone: "danger" },
    { when: ({ data }) => data.status === "S1C", tone: "success" },
    { when: ({ data }) => data.issued, tone: "warning" }
  ],
  onRowDragEnd: ({ fromIndex, targetIndex, applied }) => {
    // 自动模式已完成移动；需要持久化时，交给应用自己的保存流程。
  }
};
```

上面的状态码仅是使用侧示例。规则按顺序取第一条命中结果，未命中的行沿用默认样式；支持主题语义色及自定义 `backgroundColor` / `color`。整行颜色覆盖固定列，兼容斑马纹、选择、明暗主题和虚拟滚动，数据更新后自动重算。

拖拽提供固定手柄、来源行提示、跨列落点线、位置浮层、边缘自动滚动、Esc 取消和 Alt + ↑/↓ 键盘移动。默认自动调整扁平本地行顺序；存在列排序、树、分组、远程或外部处理模式时禁用自动重排。扁平数据由服务端维护顺序时使用 `applyRowDrag: false` 接收移动意图。`targetIndex` 是最终显示下标，旧 `toIndex` 保留插入边界语义；自动模式现在先移动再发出事件。

完整配置、限制和升级事项见[行拖拽与条件整行颜色](./docs/recipes/row-presentation.md)。

## 按需工作台与高级数据能力

Core、Vue、React 共享下面八个子入口。Vue 项目将包名写为 `@agile-team/mach-table-vue`，React 写为 `@agile-team/mach-table-react`；仍然只安装一个适配包。普通根入口不导入这些高级实现和附加样式。

| 子入口 | 能力 | 配方 |
| --- | --- | --- |
| `/workbench` | 高级过滤草稿、批量修改差异与冲突审阅、按需诊断与行状态解释 | [工作台](./docs/recipes/workbench.md) |
| `/preferences` | 租户/用户/页面/Schema 隔离、CAS、有序写入、历史状态和列类型迁移报告 | [企业偏好](./docs/recipes/enterprise-preferences.md) |
| `/ordering` | 多行与树移动、防环和父级约束、稳定身份保存、失败回滚、撤销/重做 | [排序协议](./docs/recipes/row-presentation.md) |
| `/server-side` | 服务端分组、聚合、route 分页缓存、事务刷新和层级选择 | [层级 Store](./docs/recipes/server-side-store.md) |
| `/multi-range` | Ctrl/Cmd 追加选区、格式化复制、校验清空与单次撤销 | [多范围](./docs/recipes/multi-range.md) |
| `/analysis` | 有界 Pivot、算术与聚合公式、柱/折线图及完整数据表回退 | [分析](./docs/recipes/analysis.md) |
| `/import` | 有界导入预览、规范值、异步校验、结构化错误与过期保护 | [导入预览](./docs/recipes/import-preview.md) |
| `/business` | 字典显示/解析/输出策略、本地语义合计与显式范围 | [业务列与字典](./docs/recipes/business-columns.md) |

```ts
import { mountAdvancedFilterBuilder, mountChangeReview } from "@agile-team/mach-table-vue/workbench";
import "@agile-team/mach-table-vue/styles/workbench.css";

// 复用同一份表格 API、过滤 AST、校验及保存协议。
const filters = mountAdvancedFilterBuilder(filterHost, { api });
const review = mountChangeReview(reviewHost, { api, save: orderApi.saveChanges });
// 宿主卸载时释放；表格销毁也会自动关闭对应工作台。
filters.destroy();
review.destroy();
```

服务端排序使用稳定 ID 和预期版本。`createRowOrderController()` 的 `bindings` 可直接合入表格配置；复杂撤销的保存端必须一次 CAS 处理 `context.operations` 全批次，或原子保存 `context.plan.after`，不能只保存首个意图。服务端分组使用独立 `/styles/server-side.css`；分析和多范围样式使用 `/styles/workbench.css`。没有 UI 的纯计算、偏好和排序控制器无需附加样式。

Vanilla 示例包含高级筛选、修改审阅、分析、平面/树排序及服务端分组的可操作入口，模拟传输有明确标记。自动矩阵覆盖三浏览器、明暗和强制颜色；人工读屏与真实业务 UAT 的完成状态独立记录，不将模拟接口当作生产验收。

## 一份列值策略贯通输入与导出

在 `columnTypes` 或列上配置 `valueParser` / `valueSerializer`，编辑、粘贴与导入复用解析；CSV、剪贴板和 XLSX 复用序列化。排序与过滤读取已经规范化的记录值，可信事务与撤销不重复解析。长整型标识默认不会被不安全的数字转换舍入；精确小数与业务日期格式应由列策略显式定义。

`api.io.importMatrix()` 的 replace/append 同步装载经 parser 规范化的记录，不运行交互校验；paste 复用交互校验与撤销管线，同步 boolean 不代表异步校验完成。需要整批校验、预览和问题明细时按需使用 `createImportPlan()`。XLSX 默认直接传递 number、boolean 和 Date，不经格式化 CSV 往返。详见[列值策略](./docs/recipes/column-values.md)和[导入预览](./docs/recipes/import-preview.md)。

## 字典展示与合计口径显式配置

`/business` 提供两个无 UI、无运行时依赖的可选辅助。`createDictionaryColumn()` 连接已有字典 Provider，通过同步 `get()` 显示标签，显式选择剪贴板、CSV、XLSX 输出编码、标签或码名；未配置的输出保留原编码及类型。输入优先保留原码，重复标签拒绝歧义；选项快照替换后更新反向索引，不在每个单元格扫描完整字典。

```ts
import { createDictionaryColumn, summarizeRows } from "@agile-team/mach-table-vue/business";

// dictionaryProvider 由应用提供；异步预热后再刷新单元格或执行导出。
const statusColumn = {
  field: "status",
  ...createDictionaryColumn(dictionaryProvider, {
    options: () => statusOptions,
    display: "label",
    output: { clipboard: "label", csv: "code-label" }
  })
};

const summary = summarizeRows(pageRows, {
  scope: "page",
  groupBy: row => JSON.stringify([row.currency, row.unit]),
  metrics: [
    { id: "amount", kind: "sum", value: row => row.amount },
    { id: "count", kind: "count" },
    { id: "completion", kind: "ratio", numerator: row => row.completed, denominator: row => row.planned }
  ]
});
```

合计支持 `sum`、`count`、先汇总再相除的 `ratio` 和 `none`；调用方按币种、单位等业务口径分组。`scope` 标记本页、已选或查询范围，仅处理传入记录；服务端全量仍由后端计算。默认使用安全范围内的有限 `number`，精确金额可接入已有 `numeric` 策略，不内置 Decimal 引擎。结果复用已有 `summaryMethod` 或固定行，详见[完整配方](./docs/recipes/business-columns.md)。

已有 `createCachedDictionary()` 继续从根入口导入。同 key 排队与在途请求复用，失效后旧响应不能回灌；成功返回但缺失的 key 受相同 TTL/LRU 限制，失败可重试，销毁与错误观察回调不会遗留等待任务。缓存实例及字典选项的组织、语言和权限范围仍由应用管理。

## 一份清爽的应用配置

把通用约定集中在 `mach-table.config.ts`。应用入口只负责安装，具体页面通过 props 覆盖；优先级为：应用默认值 → 命名预设 → 表格 props。

```ts
// src/config/mach-table.config.ts
import {
  createBusinessColumnTypes,
  defineMachTableConfig,
  defineMachTablePreset
} from "@agile-team/mach-table-vue";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    columnLayout: "fit",
    enableColumnResize: true,
    defaultColDef: { sortable: true, resizable: true, filter: true },
    pagination: { pageSize: 20, pageSizeOptions: [20, 50, 100] }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ stripedRows: true, columnMenu: true }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow" })
  },
  columnTypes: createBusinessColumnTypes({ locale: "zh-CN", currency: "CNY" })
});
```

```ts
// Vue main.ts
app.use(MachTablePlugin, machTableConfig);
```

```tsx
// React root.tsx
<MachTableProvider config={machTableConfig}><App /></MachTableProvider>
```

`rowData`、`columnDefs`、请求状态、初始状态和 `persistence` 属于具体实例，配置中心默认严格拒绝它们进入 defaults/preset，避免跨页面数据或身份串用；应用级 `components`、`columnTypes` 使用配置对象顶层专用字段。详见[配置中心](./docs/guide/configuration.md)。

## 领域化 API：找到能力，不记方法海洋

0.28 只保留一套公共命令模型。根级仅负责生命周期、配置、事件和批处理；业务命令进入 12 个职责明确的领域。

```ts
api.batch((grid) => {
  grid.rows.transact({ update: changedRows });
  grid.columns.setVisible("internalNote", false);
  grid.view.refreshCells({ rowIds: changedIds, columns: ["status"] });
});

const result = await api.editing.save(orderApi.saveChanges);
console.table(result.failures);
console.info(api.diagnostics.getPerformance());
```

| 领域 | 职责 |
| --- | --- |
| `rows` | 数据、事务、行遍历、远程加载与缓存 |
| `columns` | 列定义、状态、宽度、固定、顺序和列工作台 |
| `selection` | 行选择与范围选择 |
| `editing` | 编辑、变更、保存、回滚、撤销重做 |
| `filtering` / `sorting` | 普通/高级/快速过滤与排序模型 |
| `pagination` | 页码、页大小和总量 |
| `hierarchy` | 树、分组和详情展开 |
| `view` | 滚动、局部刷新、布局、覆盖层与固定行 |
| `state` | 完整可序列化状态 |
| `io` | CSV、打印、范围复制 |
| `diagnostics` | 实例、性能、错误和调度快照 |

完整签名见 [GridApi](./docs/api/grid-api.md)。

## 按需加载与包边界

| 入口 | 用途 |
| --- | --- |
| `@agile-team/mach-table-vue` / `-react` | 基础组件、生命周期 Hook、Core 类型 |
| `.../workflows` | 远程查询、编辑闭环、组合控制器 |
| `.../ui` | 可选标准工具栏 |
| `.../adapters` | 自定义 Vue/React renderer 桥接 |
| `.../worker` | 大型本地数据 Worker 处理 |
| `@agile-team/mach-table-vue/editors` | 可选 Element Plus 编辑器 |
| `@agile-team/mach-table-xlsx` | 可选 XLSX 导入导出 |

Vue 可按项目覆盖率选择局部导入、同步全局插件或异步全局插件。React 采用模块导入和路由级 `lazy`，不模拟全局组件注册。详见 [Vue 接入](./docs/guide/vue.md)与 [React 接入](./docs/guide/react.md)。

## 可控的列宽与状态记忆

列宽交互默认关闭。开启 `enableColumnResize` 后支持鼠标/触控拖动、双击自动宽度和键盘调整；不配置 `persistence` 时不会写入存储。

```ts
const options = {
  enableColumnResize: true,
  // 只保存列宽、顺序、显隐和固定；排序使用独立 "sort" 区段
  persistence: { key: "tenant:user:orders", sections: ["columns"] }
};
```

需要恢复完整工作区时省略 `sections`；可通过 `store` 接入后端或 IndexedDB，通过 `debounceMs` 调整保存节奏。`sections` 同时限制写入与恢复，异步保存保持顺序，晚到加载不会覆盖用户刚完成的操作。持久化、`initialState` 与手动 `api.state.apply()` 均走同一份 GridState 契约。

## 编辑与复杂业务工作流

单元格编辑默认提供轻量编辑提示与就地对勾/取消；鼠标移动、普通焦点移出和中文输入法组合过程不会提前结束编辑。点击另一可编辑格会先校验提交当前值再无缝切换，校验失败则保留原编辑器；对勾/取消控件及 Enter、Escape、Tab 提供显式键盘流程。`editType: "fullRow"` 将可编辑单元格作为一个原子事务提交。操作列默认直接显示查看/编辑/删除图标，低频动作收入 `…` 菜单，也支持 `drawer`、`inline` 两种溢出形态。

```ts
import { rowActionsColumn } from "@agile-team/mach-table-vue";

const columns = [
  { field: "name", editable: true },
  { field: "amount", editable: true, cellEditor: "number" },
  rowActionsColumn({
    onView,
    onEdit: ({ data }) => openEditModal(data),
    onDelete,
    extraActions: customActions
  })
];
```

远程 B 端列表从适配包的 `/workflows` 使用 `useMachTableQuery`：内置取消旧请求、防止过期响应覆盖、加载/空/错状态、服务端分页和跨页选择。`useMachTableEditing` 提供脏状态、部分成功、失败定位和乐观锁冲突闭环。

## 架构原则

- 有资源所有权、缓存与销毁边界的能力使用 class service。
- 排序、过滤、状态归一化和配置合并使用纯函数。
- 业务扩展通过 `GridFeature` 与实例级组件组合，不继承内部 `GridCore`。
- `GRID_OPTION_META` 是 Core 与两套框架适配器的配置事实源。
- Core 保持零运行时依赖；可选 UI、Worker、编辑器和 XLSX 均为独立子入口。

详见[架构设计](./docs/advanced/architecture.md)与 [API 治理](./docs/advanced/api-governance.md)。

## 质量基线

提交前统一执行：

```bash
pnpm install
pnpm verify
pnpm test:e2e
```

门禁覆盖 ESLint、TypeScript、单元与覆盖率、复杂度预算、依赖循环、API 快照、Vue SFC 消费端、ESM/CJS exports、publint、gzip 预算、发布产物、示例与文档构建。当前历史复杂度豁免为 `0`，所有生产函数统一受 `15` 的上限约束。E2E 覆盖 Chromium、Firefox、WebKit，并包含大数据与生命周期性能场景。

## 文档地图

| 目标 | 文档 |
| --- | --- |
| 首次接入 | [快速开始](./docs/guide/getting-started.md) · [企业接入手册](./docs/guide/enterprise-integration.md) |
| 框架 | [Vue 3](./docs/guide/vue.md) · [React 18+](./docs/guide/react.md) · [SSR](./docs/guide/ssr.md) |
| API | [GridOptions](./docs/api/grid-options.md) · [GridApi](./docs/api/grid-api.md) · [ColDef](./docs/api/col-def.md) · [Events](./docs/api/events.md) |
| 高频场景 | [场景示例](./docs/guide/scenarios.md) · [远程查询](./docs/recipes/remote-query.md) · [服务端导出](./docs/recipes/remote-export.md) · [编辑](./docs/recipes/editing.md) · [状态持久化](./docs/recipes/grid-state.md) · [列宽](./docs/recipes/column-state.md) · [行顺序与颜色](./docs/recipes/row-presentation.md) |
| 工程治理 | [质量门禁](./docs/advanced/quality-gates.md) · [性能](./docs/advanced/performance.md) · [升级指南](./docs/guide/upgrading.md) |

## 版本与授权

当前源码版本为 `0.34.0`，仍处于 0.x 真实项目验证期，尚未冻结 1.0 API。本版新增显式可选 `/business` 的字典列值策略与本地语义合计，完善字典缓存请求复用、失效代次、缺失项缓存和销毁边界。Vue/React 保持一个包接入，原根入口 API、XLSX 行为与已有体积预算保持兼容。升级边界见[升级指南](./docs/guide/upgrading.md)，本轮验证、发布与消费状态，以及真实读屏、触屏和业务 UAT 单独列于[实施台账](./docs/advanced/implementation-plan.md)。

Copyright © 2026 ChenyCHENYU (Agile Team). All rights reserved.

MachTable 采用 [MachTable Source-Available License 1.0](./LICENSE)，不是 MIT，也不是 OSI 定义的开源软件。查看源码不代表取得使用权；安装、运行、测试、修改、集成、部署、分发或商业使用均须事先取得作者书面授权。申请流程见[授权说明](./LICENSING.md)。

提交信息使用 `type(scope): subject`。问题与建议请通过 [GitHub Issues](https://github.com/ChenyCHENYU/MachTable/issues) 提交。
