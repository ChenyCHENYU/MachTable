# 包与导出入口

MachTable 按运行时成本和职责拆分入口。Vue/React 项目只安装对应适配包，它会自动依赖 Core 并重导出公共核心类型；可选工作流、UI、适配器、Worker 和 XLSX 不进入基础页面 chunk。

## Core：`@agile-team/mach-table`

### 根入口

主要运行时导出：

| 类别 | 导出 |
| --- | --- |
| 创建 | `createGrid`、`version` |
| 列定义 | `defineColumns`、`createColumnHelper`、`selectionColumn`、`indexColumn`、`dragColumn`、`actionsColumn`、`rowActionsColumn` |
| 配置 | `defineGridOptions`、`defineMachTableConfig`、`defineMachTablePreset`、`createMachTablePreset`、`createEnterprisePreset` |
| 业务列 | `createBusinessColumnTypes`、`createCachedDictionary`、`createDictionaryRenderer` |
| 状态/视图 | `normalizeGridState`、`saveGridState`、`loadGridState`、`clearGridState`、`createLocalGridStateStore`、`createGridViewManager` |
| 过滤 | `advancedFilterCondition`、`advancedFilterGroup`、`normalizeAdvancedFilterModel`、`normalizeFilterModel` |
| 操作与渲染 | `createMachTableCommands`、`createActionButtonsRenderer`、`createRowActionsRenderer`、`createStatusTagRenderer`、`createProgressBarRenderer` |
| 安全/IO 帮助 | `sanitizeFormulaCell`、`parseCsv`、`parseTsv`、`toTsv`、`escapeHtml`、`downloadFile` |
| 扩展治理 | `resolveGridFeatures`、`validateGridOptions`、`resolveSaveConflict` |
| 国际化 | `DEFAULT_LOCALE`、`LOCALE_EN`、`formatText` |

公共类型包括 `GridOptions`、`GridApi` 及全部领域 API、`ColDef`、`GridState`、`GridFeature`、`GridDatasource`、事件、编辑保存、业务列、视图和 Worker 消息契约。

### `@agile-team/mach-table/worker`

大型本地数据 Worker 的运行时工厂与 worker scope 安装器。仅需要 Worker 的页面导入。

### `@agile-team/mach-table/adapter`

官方 Vue/React 适配器使用的配置归一化和 Option 元数据桥。它用于框架适配开发，不是普通业务页面入口；其兼容级别低于根公共 API。

### 样式

```ts
import "@agile-team/mach-table/styles/mach-table.css";
```

## Vue：`@agile-team/mach-table-vue`

根入口导出：

- `MachTable`、`MachTablePlugin`、`useMachTable`
- `provideMachTableConfig`、`useMachTableConfig`、`MACH_TABLE_CONFIG_KEY`
- `MachTableVueProps`、`MachTableVueExposed` 等类型
- Core 全部公共导出

可选子入口：

| 子入口 | 导出/用途 |
| --- | --- |
| `/async` | `AsyncMachTablePlugin`、`AsyncMachTable`、`createAsyncMachTable`、`preloadMachTable` |
| `/workflows` | `useMachTableQuery`、`useMachTableEditing`、`useMachTableController` |
| `/ui` | `MachTableToolbar`、`MachTableUiPlugin` |
| `/adapters` | Vue renderer/detail/editor/overlay/slot 桥接函数 |
| `/editors` | `vueCellEditor`、`createElementPlusEditors` |
| `/worker` | Core Worker 能力的 Vue 包内入口 |

```ts
import { MachTable, useMachTable } from "@agile-team/mach-table-vue";
import { useMachTableQuery } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";
```

样式：

```ts
import "@agile-team/mach-table-vue/styles.css";
```

## React：`@agile-team/mach-table-react`

根入口导出：

- `MachTable`（同时是默认导出）、`useMachTable`
- `MachTableProvider`、`useMachTableConfig`
- `MachTableReactProps` 等类型
- Core 全部公共导出

可选子入口：

| 子入口 | 导出/用途 |
| --- | --- |
| `/workflows` | `useMachTableQuery`、`useMachTableEditing`、`useMachTableController` |
| `/ui` | `MachTableToolbar` |
| `/adapters` | `reactCellRenderer`、`reactDetailRenderer` |
| `/worker` | Core Worker 能力的 React 包内入口 |

```tsx
import { MachTable, useMachTable } from "@agile-team/mach-table-react";
import { useMachTableQuery } from "@agile-team/mach-table-react/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";
import { reactCellRenderer } from "@agile-team/mach-table-react/adapters";
```

样式：

```ts
import "@agile-team/mach-table-react/styles.css";
```

React 不提供全局组件注册。路由按需加载使用普通路由拆包或：

```tsx
const MachTable = lazy(() => import("@agile-team/mach-table-react"));
```

## XLSX：`@agile-team/mach-table-xlsx`

只在 Excel 页面安装：

```bash
pnpm add @agile-team/mach-table-xlsx xlsx
```

```ts
import { createXlsxExtension } from "@agile-team/mach-table-xlsx";

const excel = createXlsxExtension(() => import("xlsx"));
await excel.export(api, { fileName: "orders.xlsx" });
```

工作簿引擎由宿主动态注入，普通表格页面不会下载 XLSX 代码。

## 入口治理规则

- 根入口只放高频、稳定、跨场景的能力。
- 可选重量能力使用明确子入口，不添加同义别名。
- 内部 class、服务、registry 和布局算法不从包入口导出。
- 导出签名由 `api/public-api.snapshot.json` 门禁；修改后必须说明迁移并更新快照。
- 0.24 不保留已移除名称的兼容层，避免未正式接入前就背负永久维护成本。
