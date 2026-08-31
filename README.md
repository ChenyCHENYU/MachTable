<p align="center">
  <img src="./assets/mach-table-logo.svg" alt="MachTable Enterprise Data Grid" width="920" />
</p>

<p align="center">
  <strong>面向复杂 B 端业务的高性能 TypeScript 数据表格</strong><br />
  框架无关内核 · Vue 3 优先 · React 18+ 官方支持
</p>

<p align="center">
  <img src="https://img.shields.io/badge/source-0.24.0-2563eb" alt="Source version 0.24.0" />
  <a href="https://www.npmjs.com/package/@agile-team/mach-table"><img src="https://img.shields.io/npm/v/@agile-team/mach-table?label=npm&color=3178c6" alt="npm version" /></a>
  <a href="https://github.com/ChenyCHENYU/MachTable/actions/workflows/ci.yml"><img src="https://github.com/ChenyCHENYU/MachTable/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-authorization%20required-dc2626" alt="Authorization required" /></a>
  <img src="https://img.shields.io/badge/core%20runtime%20dependencies-0-14b8a6" alt="Zero core runtime dependencies" />
  <img src="https://img.shields.io/badge/TypeScript-first-6366f1" alt="TypeScript first" />
</p>

<p align="center">
  <a href="./docs/guide/getting-started.md"><strong>快速开始</strong></a> ·
  <a href="./docs/guide/enterprise-integration.md"><strong>企业接入</strong></a> ·
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
| 编辑 | 单元格与原子整行编辑、对勾/取消、同步/异步校验、脏数据、撤销重做、部分保存与冲突处理 |
| 交互 | 多选/范围选择、复制粘贴、填充柄、拖拽、列宽调整、列工作台、上下文菜单、操作列 |
| 框架体验 | Vue 原生 slots、React renderer、全局/局部/异步接入、远程查询与编辑工作流 |
| 治理 | 分层配置、命名预设、配置来源解释、领域化 API、版本化状态、稳定错误码、诊断快照 |
| 安全 | CSV 公式注入防护、安全字段路径、Overlay 默认文本渲染、资源销毁与请求取消 |

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
import { ref } from "vue";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-vue";
import "@agile-team/mach-table-vue/styles.css";

interface Order { id: string; customer: string; amount: number }

const table = useMachTable<Order>();
const rows = ref<Order[]>([{ id: "SO-001", customer: "Acme", amount: 12800 }]);
const columns: ColDef<Order>[] = [
  { field: "id", headerName: "订单号", width: 130, pinned: "left" },
  { field: "customer", headerName: "客户", flex: 1, editable: true, filter: "text" },
  { field: "amount", headerName: "金额", width: 140, filter: "number" }
];
</script>

<template>
  <div style="height: 560px">
    <MachTable
      :ref="table.ref"
      :column-defs="columns"
      :row-data="rows"
      row-key="id"
      row-selection="multiple"
      enable-column-resize
      :persistence="{ key: 'orders:list' }"
      striped-rows
    />
  </div>
</template>
```

### React 18+

```tsx
import { useMemo } from "react";
import { MachTable, useMachTable, type ColDef } from "@agile-team/mach-table-react";
import "@agile-team/mach-table-react/styles.css";

interface Order { id: string; customer: string; amount: number }

export function OrdersPage({ rows }: { rows: Order[] }) {
  const table = useMachTable<Order>();
  const columns = useMemo<ColDef<Order>[]>(() => [
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
import { createGrid } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, {
  columnDefs: [{ field: "name", headerName: "名称", flex: 1 }],
  rowData: [{ id: "1", name: "MachTable" }],
  rowKey: "id"
});

// Vue/React 适配器会自动销毁；原生接入由宿主在卸载时调用。
api.destroy();
```

> 默认虚拟布局要求容器具有明确高度。小型详情表可使用 `domLayout: "autoHeight"`，大表或远程无限数据源不要使用自动高度。

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

0.24 只保留一套公共命令模型。根级仅负责生命周期、配置、事件和批处理；业务命令进入 12 个职责明确的领域。

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
  // 只保存列宽、顺序、显隐、固定和排序
  persistence: { key: "tenant:user:orders", sections: ["columns"] }
};
```

需要恢复完整工作区时省略 `sections`；可通过 `store` 接入后端或 IndexedDB，通过 `debounceMs` 调整保存节奏。持久化、`initialState` 与手动 `api.state.apply()` 均走同一份 GridState 契约。

## 编辑与复杂业务工作流

单元格编辑默认提供轻量编辑提示与就地对勾/取消；`editType: "fullRow"` 将可编辑单元格作为一个原子事务提交。操作列支持内置查看/编辑/删除图标，也支持纯自定义动作，以及 `menu`、`drawer`、`inline` 三种溢出模式。

```ts
import { rowActionsColumn } from "@agile-team/mach-table-vue";

const columns = [
  { field: "name", editable: true },
  { field: "amount", editable: true, cellEditor: "number" },
  rowActionsColumn({ onView, onDelete, overflow: "drawer", actions: customActions })
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

门禁覆盖 ESLint、TypeScript、单元与覆盖率、复杂度预算、依赖循环、API 快照、Vue SFC 消费端、ESM/CJS exports、publint、gzip 预算、发布产物、示例与文档构建。E2E 覆盖 Chromium、Firefox、WebKit，并包含大数据与生命周期性能场景。

## 文档地图

| 目标 | 文档 |
| --- | --- |
| 首次接入 | [快速开始](./docs/guide/getting-started.md) · [企业接入手册](./docs/guide/enterprise-integration.md) |
| 框架 | [Vue 3](./docs/guide/vue.md) · [React 18+](./docs/guide/react.md) · [SSR](./docs/guide/ssr.md) |
| API | [GridOptions](./docs/api/grid-options.md) · [GridApi](./docs/api/grid-api.md) · [ColDef](./docs/api/col-def.md) · [Events](./docs/api/events.md) |
| 高频场景 | [远程查询](./docs/recipes/remote-query.md) · [编辑](./docs/recipes/editing.md) · [状态持久化](./docs/recipes/grid-state.md) · [列宽](./docs/recipes/column-state.md) |
| 工程治理 | [质量门禁](./docs/advanced/quality-gates.md) · [性能](./docs/advanced/performance.md) · [升级指南](./docs/guide/upgrading.md) |

## 版本与授权

当前源码版本为 `0.24.0`，仍处于 0.x 产品打磨期，尚未冻结 1.0 API。0.24 已移除项目尚未正式接入前积累的旧别名和重复入口，公共 API 只保留文档中的规范名称。

Copyright © 2026 ChenyCHENYU (Agile Team). All rights reserved.

MachTable 采用 [MachTable Source-Available License 1.0](./LICENSE)，不是 MIT，也不是 OSI 定义的开源软件。查看源码不代表取得使用权；安装、运行、测试、修改、集成、部署、分发或商业使用均须事先取得作者书面授权。申请流程见[授权说明](./LICENSING.md)。

提交信息使用 `type(scope): subject`。问题与建议请通过 [GitHub Issues](https://github.com/ChenyCHENYU/MachTable/issues) 提交。
