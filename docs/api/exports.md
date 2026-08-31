# 模块导出与工具

`@agile-team/mach-table` 全部导出清单（React/Vue 包按需 re-export 类型与适配器）。

## 入口函数

| 导出 | 说明 |
| --- | --- |
| `createGrid<TData>(container, options): GridApi<TData>` | 唯一入口。容器必须有尺寸；SSR 环境抛错 |
| `GridCore` | 内核编排类（高级用法/二次封装才需要） |
| `EventBus` | 事件总线类 |
| `version` | 版本号字符串 |

## 0.23 性能与治理导出

Worker 运行时代码位于可选 `/worker` 子路径，Vue/React 适配包提供同名代理入口；普通页面不会下载它：

```ts
import { createWorkerDataProcessor } from "@agile-team/mach-table-vue/worker";
```

| 导出 | 说明 |
| --- | --- |
| `createWorkerDataProcessor(factory, options?)` | 把宿主 Worker 适配为 `GridDataProcessor`；懒创建、取消转发、默认随 Grid 终止 |
| `installGridDataWorker(scope)` | 在 Worker 模块安装标准字段过滤/排序协议 |
| `processFieldDataRequest(payload, options?)` | 可测试、可自定义组合的字段路径处理函数 |
| `GridDataProcessor*` / `GridWorker*` | Processor 请求、结果、消息与 Worker scope 类型 |
| `RefreshCellsParams` / `GridAsyncOptions` | 脏单元格刷新和 AbortSignal 异步命令类型 |
| `GridRowsApi` 等领域类型 | `rows/columns/selection/editing/filtering/pagination/state/diagnostics` facade 类型 |
| `RemoteBlockCacheSnapshot` / `GridUpdateSchedulerSnapshot` | 缓存和更新合并诊断类型 |

## 注册表

```ts
import { registerCellRenderer, registerCellEditor } from "@agile-team/mach-table";

const unregister = registerCellRenderer("statusBadge", (p) => renderBadge(p.value));
registerCellEditor("ep-select", makeSelectEditor());

// ColDef 中用字符串引用 —— 配置可 JSON 序列化（低代码/Schema 友好）
{ field: "status", cellRenderer: "statusBadge" }

// HMR / 微前端卸载时精确恢复注册前状态
unregister();
```

| 导出 | 说明 |
| --- | --- |
| `registerCellRenderer(name, fn)` / `getCellRenderer(name)` | 单元格渲染器注册/查询；register 返回注销函数 |
| `registerCellEditor(name, factory)` / `getCellEditor(name)` | 编辑器注册/查询；register 返回注销函数 |
| `clearComponentRegistries()` | 清空（测试用） |

内置注册名：`statusTag`（状态徽章）、`progressBar`（进度条）、`link`（链接）。清空测试注册表后会按需幂等恢复，且不会覆盖应用自定义的同名注册。

单个 Grid 需要隔离时，优先使用实例配置：

```ts
components: {
  cellRenderers: { statusBadge },
  cellEditors: { departmentEditor }
}
```

## 功能扩展

```ts
import type { GridFeature } from "@agile-team/mach-table";

const auditFeature: GridFeature<Row> = {
  key: "audit",
  version: "1.0.0",
  requires: ["permissions"],
  conflicts: ["readonly-audit"],
  setup({ api, root, addEventListener }) {
    root.dataset.audit = "enabled";
    const off = addEventListener("cellValueChanged", (event) => audit(event));
    return () => off();
  }
};

createGrid(host, { columnDefs, rowData, features: [auditFeature] });
```

Feature 按 Grid 实例隔离；初始化前执行 key、依赖、冲突和循环校验，依赖先于使用方 setup。无效 Feature 被隔离并进入结构化诊断；替换 `features` 或销毁 Grid 时按逆序执行 cleanup/destroy。可用 `resolveGridFeatures()` 在业务注册前预检清单。

## 高级过滤、状态与命名视图

| 导出 | 说明 |
| --- | --- |
| `advancedFilterCondition()` / `advancedFilterGroup()` | 类型安全地创建嵌套过滤 AST |
| `normalizeAdvancedFilterModel()` | 克隆、限深、限量并隔离循环/非法过滤输入 |
| `migrateGridState()` | 把 GridState v1 或不可信 v2 输入迁移、归一化为 v2 |
| `createGridViewManager()` | 保存、列出、应用和删除命名视图 |
| `createLocalGridViewStore()` | 有大小/数量/error 边界的 localStorage 视图 store |
| `captureGridViewState()` / `applyGridViewState()` | 只处理展示偏好，不携带选择与展开状态 |

详见[高级过滤](/recipes/advanced-filter)、[全量状态](/recipes/grid-state)与[命名视图](/recipes/saved-views)。

## 保存结果与冲突

| 导出 | 说明 |
| --- | --- |
| `createSaveSnapshot()` | 为异步保存创建稳定、按行可选的修改快照 |
| `normalizeBatchSaveResult()` | 归一化成功、失败、冲突并忽略未提交行 ID |
| `resolveSaveConflict()` | 显式接受服务端行或保留本地修改 |
| `GridBatchSaveResult` / `SaveChangeIssue` / `SaveChangeConflict` | 详细保存协议类型 |

## 预设列工厂（精简配置）

```ts
import { selectionColumn, indexColumn, dragColumn, actionsColumn } from "@agile-team/mach-table";

columnDefs: [
  selectionColumn(),                       // 左固定复选框列（46px，无排序/调宽/换位）
  indexColumn(),                           // 左固定序号列（60px）
  { field: "name", headerName: "名称", flex: 1 },
  actionsColumn({ actions: [...] }),       // 完全自定义操作列
  rowActionsColumn({ onView, onDelete })   // 整行编辑时自动切换对勾/取消
]
```

均接受 `overrides`（`actionsColumn` 接受 `width/pinned` 覆写）合并进预设。

## 预设渲染器

| 导出 | 说明 |
| --- | --- |
| `createStatusTagRenderer({ variantMap?, labelMap? })` | 状态徽章工厂：内置中英文常见值 → 语义色映射，支持自定义映射与文案覆写 |
| `createProgressBarRenderer({ showValue?, unit?, color? })` | 进度条工厂（0-100 clamp） |
| `createActionButtonsRenderer({ actions, max?, overflow? })` | 任意操作按钮组；支持语义色、条件显示/禁用/加载、异步动作和 menu/drawer/inline 三种布局 |
| `createRowActionsRenderer(config)` / `rowActionsColumn(config)` | 查看/编辑/删除/更多的高频行操作预设；整行编辑时自动切换保存/取消 |
| `linkRenderer` | 链接样式渲染器（即 `link` 注册名） |
| `resolveTagVariant(value, variantMap?)` | 值 → 语义变体的判定纯函数 |
| 类型：`TagVariant` `StatusTagConfig` `ProgressConfig` `ActionItem` `ActionButtonsConfig` | |

用法详见[操作列与状态列](/recipes/action-columns)。

## Schema 驱动

```ts
import { buildColDefsFromSchema } from "@agile-team/mach-table";
```

| 导出 | 说明 |
| --- | --- |
| `buildColDefsFromSchema(schema)` | 设计器 JSON → `ColDef[]`。类型自动映射：number→右对齐+数字过滤、select→字典格式化+下拉编辑、boolean→是/否+set 过滤、date→日期格式化+date 过滤；`groups` 生成多级表头 |
| `GridSchema` / `GridSchemaField` / `GridSchemaGroup` / `SchemaSelectOption` | Schema 类型 |

Schema 字段：`field, title, type(string|number|date|select|boolean), width/minWidth/maxWidth/flex, pinned, editable, sortable, filterable, resizable, hidden, options, format(date|datetime), cellClass`。

## 聚合

| 导出 | 说明 |
| --- | --- |
| `BUILTIN_AGG_FUNCS` | `{ sum, avg, count, min, max, first, last }` |
| `createAggResolver(custom)` | 合并自定义聚合，返回 `(name) => fn` |
| `AggFunction` / `AggValues` | 类型 |

## 剪贴板 / CSV

| 导出 | 说明 |
| --- | --- |
| `toTsv(rows: any[][])` | 二维数组 → TSV（含引号转义） |
| `parseTsv(text): string[][]` | TSV → 二维数组（状态机解析引号/Tab/CRLF） |
| `sanitizeFormulaCell(value)` | Excel 公式注入防护（`= + @` 开头文本加 `'` 前缀，纯数字不受影响） |

## 列状态存储

| 导出 | 说明 |
| --- | --- |
| `saveColumnState(key, state)` / `loadColumnState(key)` / `clearColumnState(key)` | localStorage 直存（键前缀 `mach-table:col-state:`）。接后端请用 `options.columnStateStore` |

## 国际化

| 导出 | 说明 |
| --- | --- |
| `DEFAULT_LOCALE` | 中文默认文案（30+ 键） |
| `LOCALE_EN` | 英文预设 |
| `matchLocaleKey(match)` / `formatText(tpl, n)` | 工具（过滤条件文案映射、`{n}` 模板） |
| `RgLocale` / `RgLocaleKey` | 类型 |

## 密度与杂项

| 导出 | 说明 |
| --- | --- |
| `GRID_SIZE_PRESETS` | `{ compact, normal, large }` 密度预设常量 |
| `defaultComparator(a, b)` | 默认排序比较器（数值/日期/布尔/字符串 numeric+base，空值排末） |
| `getByPath(obj, path)` / `setByPath(obj, path, value)` / `isSafePath(path)` | 防原型污染的点路径读写与校验 |
| `computeColumnWidths(cols, available)` | flex 宽度分配纯函数 |
| `describeFilter(filter)` | 过滤模型 → 中文摘要（表头 tag 同款） |
| `evaluateColumnFilter(value, filter)` / `sortNodes(nodes, sortModel, columns, getter)` | 纯函数过滤/排序（自建管线可用） |

## 类型导出

完整类型见包内 `dist/index.d.ts`。常用：

```ts
import type {
  GridApi, GridOptions, GridState, GridStateInput, GridDiagnostics, GridPerformanceSnapshot, GridChange,
  AdvancedFilterModel, AdvancedFilterNode, GridViewState, SavedGridView, GridViewStore,
  GridBatchSaveResult, SaveChangeIssue, SaveChangeConflict,
  ColDef, ColDefGroup, ColDefOrGroup, ColumnState,
  RowNode, GridEventMap, GridEventType, GridErrorCode, GridErrorEvent, CellClickEvent, CellValueChangedEvent,
  RangeSelectionChangedEvent, GridDatasource, InfiniteGetRowsParams,
  RgLocale, GridSchema, ICellEditor, CellRendererFn, CellStyleRule,
  DetailRowRendererParams, GetRowHeightParams, StatusBarPanel,
  GridComponents, GridFeature, GridFeatureContext
} from "@agile-team/mach-table";
```

## 配置、状态与命令（0.14+）

| 导出 | 说明 |
| --- | --- |
| `defineMachTableConfig` / `normalizeMachTableConfig` / `mergeMachTableConfig` / `resolveMachTableGridOptions` | Vue/React 共享的应用配置、命名 preset 和来源解释内核 |
| `createMachTableCommands` | 搜索、刷新、列工作台、密度、重置、撤销/重做、CSV、全屏的框架无关命令面 |
| `createLocalGridStateStore` / `loadGridState` / `saveGridState` / `clearGridState` | 版本化、安全、可替换的完整 GridState 存储 |
| `FieldPath<T>` / `FieldPathValue<T, P>` | `rowKey` 与字段路径的类型推断 |

## Vue 包附加导出

根入口导出 `MachTable` / `MachTableVueProps` / `MachTablePlugin` / `provideMachTableConfig` / `useMachTableConfig` / `useMachTable`。异步子路径导出 `AsyncMachTablePlugin` / `createAsyncMachTable` / `preloadMachTable`；`workflows` 子路径导出 `useMachTableQuery` / `useMachTableEditing` / `useMachTableController`；`ui` 子路径导出 `MachTableToolbar` / `MachTableUiPlugin`；`editors` 子路径导出 `vueCellEditor` / `createElementPlusEditors`。这些都是同一安装包的按需入口。另重导出完整 Core；`RobotGrid` 及旧 Props 类型仅为 0.x 弃用别名。

## React 包附加导出

`MachTable` / `MachTableReactProps` / `MachTableProvider` / `useMachTableConfig` / `useMachTableDefaults` / `MachTableToolbar` / `reactCellRenderer` / `reactDetailRenderer` / `useMachGrid`，并重导出完整 Core。`workflows` 子路径导出 `useMachTableQuery` / `useMachTableEditing` / `useMachTableController`。`RobotGrid` 及旧 Props 类型仅为 0.x 弃用别名。

## 可选 XLSX 包

`@agile-team/mach-table-xlsx` 导出 `createXlsxExtension` / `exportGridToXlsx` / `importGridFromXlsx` 与 `XlsxEngine` 协议。它不包含工作簿引擎，推荐使用动态 loader，见[可选 XLSX](/recipes/xlsx)。

## 主题 CSS

```ts
import "@agile-team/mach-table/styles/mach-table.css";
```

子路径 exports 已配置，Vite/webpack/Rollup 均可解析。
