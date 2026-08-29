# 模块导出与工具

`@agile-team/mach-table` 全部导出清单（React/Vue 包按需 re-export 类型与适配器）。

## 入口函数

| 导出 | 说明 |
| --- | --- |
| `createGrid<TData>(container, options): GridApi<TData>` | 唯一入口。容器必须有尺寸；SSR 环境抛错 |
| `GridCore` | 内核编排类（高级用法/二次封装才需要） |
| `EventBus` | 事件总线类 |
| `version` | 版本号字符串 |

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
  setup({ api, root, addEventListener }) {
    root.dataset.audit = "enabled";
    const off = addEventListener("cellValueChanged", (event) => audit(event));
    return () => off();
  }
};

createGrid(host, { columnDefs, rowData, features: [auditFeature] });
```

Feature 按 Grid 实例隔离；替换 `features` 或销毁 Grid 时按逆序执行 cleanup/destroy。

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
  GridApi, GridOptions, GridState, GridDiagnostics, GridChange,
  ColDef, ColDefGroup, ColDefOrGroup, ColumnState,
  RowNode, GridEventMap, GridEventType, GridErrorCode, GridErrorEvent, CellClickEvent, CellValueChangedEvent,
  RangeSelectionChangedEvent, GridDatasource, InfiniteGetRowsParams,
  RgLocale, GridSchema, ICellEditor, CellRendererFn, CellStyleRule,
  DetailRowRendererParams, GetRowHeightParams, StatusBarPanel,
  GridComponents, GridFeature, GridFeatureContext
} from "@agile-team/mach-table";
```

## Vue 包附加导出

根入口导出 `MachTable` / `MachTableVueProps` / `MachTablePlugin` / `provideMachTableDefaults` / `useMachTableDefaults` / `vueCellRenderer` / `vueDetailRenderer` / `useMachTable`（`{ ref, api, ready }`）。异步子路径导出 `AsyncMachTablePlugin` / `createAsyncMachTable` / `preloadMachTable`；`workflows` 子路径导出远程查询和编辑保存 composable；`editors` 子路径导出 `vueCellEditor` / `createElementPlusEditors`，不增加第二个安装依赖。另重导出完整 Core；`RobotGrid` 及旧 Props 类型仅为 0.x 弃用别名。

## React 包附加导出

`MachTable` / `MachTableReactProps` / `MachTableProvider` / `useMachTableDefaults` / `reactCellRenderer` / `reactDetailRenderer` / `useMachGrid`（`{ apiRef, api, ready }`），并重导出完整 Core。`RobotGrid` 及旧 Props 类型仅为 0.x 弃用别名。

## 可选 XLSX 包

`@agile-team/mach-table-xlsx` 导出 `createXlsxExtension` / `exportGridToXlsx` / `importGridFromXlsx` 与 `XlsxEngine` 协议。它不包含工作簿引擎，推荐使用动态 loader，见[可选 XLSX](/recipes/xlsx)。

## 主题 CSS

```ts
import "@agile-team/mach-table/styles/mach-table.css";
```

子路径 exports 已配置，Vite/webpack/Rollup 均可解析。
