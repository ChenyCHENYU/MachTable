# GridOptions 全量配置

`createGrid(container, options)` 的完整配置项。React/Vue 组件将下表所有项作为 props 透传（camelCase）。

按类别分组；「默认值」列为未配置时的取值。

## 数据

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `columnDefs` | `(ColDef \| ColDefGroup)[] \| null` | `[]` | 列定义，支持分组表头嵌套，见 [ColDef](/api/col-def) |
| `rowData` | `TData[] \| null` | `[]` | 行数据。与 `datasource` 互斥（datasource 优先进入无限模式） |
| `getRowId` | `(p: GetRowIdParams) => string` | 自动 id | 行唯一标识。**强烈建议提供**：编辑/选择保持/撤销/无限滚动均依赖；全量替换数据时选中态保留也依赖它 |
| `defaultColDef` | `Partial<ColDef>` | 见注 | 全列默认值。内置默认：`{ sortable: true, resizable: true, movable: true, filter: false, minWidth: 80 }` |
| `datasource` | `GridDatasource` | — | 无限滚动数据源，见[配方](/recipes/infinite-scroll) |
| `blockSize` | `number` | `100` | 无限滚动每块请求行数 |
| `infiniteBufferRows` | `number` | `40` | 距已加载末尾 N 行时预取下一块 |
| `datasourceRetryCount` | `number` | `2` | 数据源失败后的自动重试次数；`0` 关闭 |
| `datasourceRetryDelay` | `number` | `300` | 首次重试基础延迟（ms），之后指数退避，最长 30 秒 |
| `asyncTransactionWaitMillis` | `number` | `16` | `applyTransactionAsync` 合并时间窗；事务保持调用顺序，管线只刷新一次 |
| `initialState` | `GridState` | — | 列、排序、过滤、分页、选择、展开等版本化首屏状态，列和初始行就绪后一次应用 |
| `pagination.mode` | `"client" \| "server"` | `"client"` | server 模式按传入页面原样展示，不二次切片；配合 `page`、`pageSize`、`total`，见[远程查询](/recipes/remote-query) |

## 尺寸与密度

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `size` | `"compact" \| "normal" \| "large"` | `"normal"` | 密度预设，字号/行高/内边距联动（12/13/14px，30/36/44px，6/9/12px），可运行时切换 |
| `theme` | `"light" \| "dark" \| "auto"` | `"light"` | 主题：`dark` 应用内置暗色；`auto` 跟随系统 `prefers-color-scheme` 并实时响应切换（水印同步适配）。传 `className: "mach-theme-dark"` 的旧写法仍兼容 |
| `rowHeight` | `number` | 按密度 | 行高 px。提供 `getRowHeight` 时作为兜底 |
| `headerHeight` | `number` | 按密度 | 单层表头高度 px（多级表头自动 × 层数） |
| `getRowHeight` | `(p: GetRowHeightParams) => number` | — | 变高行回调，见[配方](/recipes/variable-height)。无限模式未加载行使用固定 `rowHeight` |
| `rowBuffer` | `number` | `8` | 视口上下各预渲染的行数 |
| `columnLayout` | `"normal" \| "fit"` | `"normal"` | `fit` 使用 ResizeObserver 持续填满容器，无需在 grid-ready/resize 中手调 `sizeColumnsToFit` |
| `className` | `string` | `""` | 追加到根元素的类名（如 `mach-theme-dark`、主题桥接类） |

## 视觉

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `stripedRows` | `boolean` | `false` | 斑马纹（奇数行 `--mach-zebra-bg`） |
| `showCellBorders` | `boolean` | `false` | 纵向网格线（默认留白分区风格） |
| `loading` | `boolean` | `false` | 显示加载覆盖层 |
| `overlayLoadingTemplate` | `string \| HTMLElement \| () => string \| HTMLElement` | 内置 spinner | 加载覆盖层。字符串默认按纯文本渲染，推荐返回 HTMLElement |
| `overlayNoRowsTemplate` | `string \| HTMLElement \| () => string \| HTMLElement` | 内置空状态 | 空数据覆盖层。字符串默认按纯文本渲染，推荐返回 HTMLElement |
| `allowUnsafeOverlayHtml` | `boolean` | `false` | 将上述字符串按 HTML 渲染；只能用于完全可信的静态内容，禁止传入服务端/用户输入 |
| `suppressNoRowsOverlay` | `boolean` | `false` | 关闭空数据覆盖层 |
| `suppressRowHoverHighlight` | `boolean` | `false` | 关闭行悬停高亮（跨三窗格同步） |
| `suppressWarnings` | `boolean` | `false` | 静默配置校验告警（重复 colId、缺字段值来源等；treeData 组合告警同样受控） |

## 选择

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `rowSelection` | `"none" \| "single" \| "multiple"` | `"none"` | 选择模式。`single` 时复选框列呈 radio 形态 |
| `treeData` 相关 | 见下 | — | `autoCheckedChildren` 默认 `true`：树形父子复选框级联 + 父节点三态 |

## 排序 / 过滤

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `multiSort` | `boolean` | `true` | Shift 点击表头叠加多列排序（带序号徽标） |
| `quickFilterText` | `string \| null` | `null` | 全局快速过滤（分词 AND、跨列 OR 包含） |
| `manualSorting` | `boolean` | `false` | 服务端排序：跳过本地排序但更新指示器并触发 `sortChanged` |
| `manualFiltering` | `boolean` | `false` | 服务端过滤：跳过本地过滤但触发 `filterChanged` |
| `aggFuncs` | `Record<string, (values) => any>` | — | 自定义聚合函数（内置 sum/avg/count/min/max/first/last） |

## 编辑

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `editType` | `"cell" \| "fullRow"` | `"cell"` | 单元格就地编辑，或整行暂存后统一校验/提交；见[编辑配方](/recipes/editing) |
| `editableIndicator` | `"hover" \| "always" \| "none"` | `"hover"` | 单元格模式下铅笔入口的显示策略；不影响双击和键盘编辑 |
| `rowEditValidator` | `(params) => result \| Promise<result>` | — | 整行跨字段校验；`params.values` 按 colId 提供草稿，返回字符串或 colId→错误映射 |
| `singleClickEdit` | `boolean` | `false` | 单击进入编辑（可被列级 `singleClickEdit` 覆盖） |
| `undoStackSize` | `number` | `100` | 撤销栈深度；`0` 关闭撤销，见[配方](/recipes/undo-redo) |

## 范围 / 剪贴板 / 交互反馈

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `enableRangeSelection` | `boolean` | `false` | 单元格范围框选（拖选 / Shift+点击 / Shift+方向键） |
| `fillHandle` | `boolean` | `true` | 填充柄（依赖 enableRangeSelection） |
| `contextMenu` | `boolean` | `false` | 右键菜单；默认项（复制/粘贴/清除），`getContextMenuItems` 可完全自定义 |
| `getContextMenuItems` | `(p: ContextMenuParams) => ContextMenuItem[] \| null` | — | 自定义菜单项（label/action/danger/disabled/separator）；返回 `null` 不弹菜单 |
| `suppressClipboard` | `boolean` | `false` | 禁用 Ctrl+C/X/V 与菜单剪贴板项 |
| `flashCells` | `boolean` | `true` | 单元格值变更（编辑/粘贴/填充/撤销）后闪烁高亮反馈 |
| `tooltipComponent` | `(p: TooltipParams) => string \| HTMLElement` | — | 富悬停提示（替代原生 title；返回 DOM 可放任意内容）。未配置时保持原生 title |
| `tooltipShowDelay` | `number` | `600` | 悬停多少毫秒后显示提示 |

## 行结构

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `treeData` | `boolean` | `false` | 树形数据模式 |
| `childrenKey` | `string` | `"children"` | 树形子节点字段 |
| `isTreeRowExpandable` | `(p) => boolean` | — | 标记尚无本地 children 但可从服务端展开的节点 |
| `loadTreeChildren` | `async ({ data, node, api, signal }) => rows` | — | 首次展开时懒加载子级；支持取消、去重、错误状态与重试 |
| `defaultExpandAll` | `boolean` | `false` | 初始展开全部树节点 |
| `autoCheckedChildren` | `boolean` | `true` | 树形复选框父子级联 |
| `masterDetail` | `boolean` | `false` | 主从明细模式 |
| `detailRowHeight` | `number` | `240` | 明细行高度 |
| `detailRowRenderer` | `(p: DetailRowRendererParams) => RenderOutput` | — | 明细内容渲染器（可返回 `{ el, destroy }` 嵌套子表格） |
| `isRowExpandable` | `(p) => boolean` | 全部可展开 | 行级展开开关（无子节点时隐藏箭头由 treeData 自动处理） |
| `detailToggleColumn` | `boolean` | `true` | 自动插入左侧 ▶ 展开列 |
| `applyRowDrag` | `boolean` | `true` | 行拖拽后自动应用重排；`false` 时仅发 `rowDragEnd` 事件自行处理 |
| `indexOffset` | `number` | `0` | 序号列起始偏移（配合 `type: "index"`） |
| `pinnedTopRowData` | `TData[] \| null` | `[]` | 固定首行（只读汇总条），见[配方](/recipes/pinned-rows) |
| `pinnedBottomRowData` | `TData[] \| null` | `[]` | 固定末行 |
| `pagination` | `boolean \| PaginationConfig` | **开启** | 内置分页器：`{ pageSize: 20, pageSizeOptions: [10,20,50,100], showTotal, showPageSizeSelector }`。无数据自动隐藏；`datasource` 模式自动关闭；见[配方](/recipes/pagination-io) |
| `watermark` | `boolean \| WatermarkConfig` | 关闭 | 水印：`{ text, fontSize?, opacity?, gap?, angle?, color? }`，canvas 平铺斜纹、pointer-events none、暗色自动适配 |

## 汇总

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `showSummary` | `boolean` | `false` | 显示底部合计行 |
| `summaryMethod` | `(p: { colId, column, values }) => string` | 行数 | 每列合计文本；默认首列显示总行数 |
| `statusBar` | `boolean \| { panels: StatusBarPanel[] }` | `false` | 状态栏；panels 可选 `rowCount` / `selectedRowCount` / `rangeAggregate`（框选数值实时 和·均·计） |

## 列设置与状态记忆

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `columnMenu` | `boolean` | `false` | 每列表头 ⋯ 菜单（排序/固定/自适应/隐藏/列显示清单），可运行时切换 |
| `columnStateKey` | `string \| null` | `null` | 列状态（宽/序/显隐/固定/排序）自动持久化键，见[配方](/recipes/column-state) |
| `columnStateStore` | `{ load(key), save(key, state) }` | localStorage | 自定义存储；`load` 支持返回 Promise（接后端接口） |

## 国际化与杂项

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `locale` | `RgLocale` | 中文 | 覆盖内置文案，提供 `LOCALE_EN` 英文预设，见 [i18n](/advanced/i18n) |
| `components` | `GridComponents` | — | 当前 Grid 的渲染器/编辑器注册表，优先级高于全局注册，适合微前端和多租户隔离 |
| `features` | `GridFeature[]` | `[]` | 实例级功能扩展；提供 setup/cleanup/destroy 生命周期，不需要修改 GridCore |
| `suppressCellFocus` | `boolean` | `false` | 关闭单元格焦点（同时关闭键盘导航） |
| `suppressHeaderFocus` | `boolean` | `false` | 关闭表头焦点环 |
| `ariaLabel` | `string` | `"MachTable data grid"` | 内部 `role=grid/treegrid` 元素的可访问名称 |
| `ariaLabelledBy` | `string` | `""` | 外部标签元素 id；配置后优先于 `ariaLabel` |
| `ariaDescribedBy` | `string` | `""` | 外部操作说明元素 id |
| 事件回调 | `onCellClicked`、`onGridError` 等 | — | 见 [事件](/api/events)；用户回调异常会被隔离并上报 |

## 0.14 使用体验配置

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `rowKey` | `FieldPath<TData> \| (row) => string \| number` | — | 稳定行主键简写；支持点路径。与 `getRowId` 同时配置时后者优先 |
| `domLayout` | `"normal" \| "autoHeight"` | `"normal"` | 自动高度会渲染全部客户端行，只用于小表；不能与 `datasource` 混用 |
| `error` | `unknown \| null` | `null` | 一等请求/页面错误状态；非空时显示错误 overlay，优先级高于 empty |
| `overlayErrorTemplate` | `OverlayTemplate` | 内置可访问错误提示 | 错误 overlay；字符串仍按纯文本安全渲染 |
| `stateKey` | `string \| null` | `null` | 自动加载和防抖保存完整 GridState |
| `stateStore` | `GridStateStore` | 安全 localStorage store | 可替换为后端、IndexedDB 或测试内存 store；支持异步 |
| `stateSaveDebounceMs` | `number` | `160` | 自动状态保存防抖时间；销毁前会刷新待保存内容 |

默认虚拟布局必须给宿主容器明确高度。`autoHeight` 的意义是免高度的小型详情表，不是大数据表性能开关。状态 key 应包含用户/租户/视图维度，避免不同主体共享选择和筛选状态。

## 类型速查

```ts
import type { GridOptions, GridDatasource, StatusBarPanel } from "@agile-team/mach-table";

const options: GridOptions<Row> = { /* ... */ };
```

安全的自定义空状态：

```ts
overlayNoRowsTemplate: () => {
  const element = document.createElement("strong");
  element.textContent = "暂无数据";
  return element;
}
```
