# ColDef 列定义

列描述符是 MachTable 声明式配置的核心。`columnDefs` 数组的元素为 `ColDef`（叶子列）或 `ColDefGroup`（表头分组）。

## 标识与标题

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `colId` | `string` | `field` 或 `col_{i}` | 列唯一标识（排序模型/过滤模型/列状态都以它为键）。同名自动去重加后缀 |
| `field` | `string` | — | 数据取值字段，支持点路径 `a.b.c` |
| `headerName` | `string` | `field` | 表头文本 |
| `align` | `"left" \| "center" \| "right"` | `"center"` | 单元格内容默认居中；可按列显式覆盖为左对齐或右对齐 |
| `headerAlign` | `"left" \| "center" \| "right"` | 跟随 `align` | 表头文本对齐（独立于单元格） |
| `headerTooltip` | `string` | — | 表头 title 提示 |
| `headerClass` | `string \| string[]` | — | 表头附加类名 |
| `headerComponent` | `(p) => string \| HTMLElement \| { el, destroy }` | — | 自定义表头内容 |

## 宽度与布局

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `width` | `number` | 内容测宽 | 显式首选宽度 px；普通布局固定，显式 fit 模式按比例铺满 |
| `autoWidth` | `boolean` | `true` | 未声明 width 时按内容抽样测宽；false 使用原默认 150px |
| `minWidth` / `maxWidth` | `number` | `80` / 自动测宽 360 | 显式边界优先；自动默认上限不会约束手动调宽 |
| `flex` | `number` | `0` | 弹性权重：容器有多余空间时按权重分配 |
| `suppressSizeToFit` | `boolean` | `false` | 在 `columnLayout: "fit"` 下保持本列宽度；选择、序号、拖拽和操作列模板默认开启 |
| `suppressColumnMenu` | `boolean` | `false` | 隐藏本列表头的列工具入口；全局列工作台仍可管理该列，辅助列模板默认开启 |
| `pinned` | `"left" \| "right" \| boolean` | — | 固定列；`true` 等价 `"left"` |
| `hide` | `boolean` | `false` | 初始隐藏 |

## 交互开关

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `sortable` | `boolean` | `true` | 点击表头排序（asc → desc → 无） |
| `resizable` | `boolean` | `true` | 当前列是否允许调宽；只有表格级 `enableColumnResize: true` 时才显示拖动把手并启用快捷键 |
| `movable` | `boolean` | `true` | 拖拽表头换位（分组内或同窗格内） |
| `filter` | `boolean \| "text" \| "number" \| "date" \| "set"` | `false` | 过滤器类型；`true` 等价 `"text"`。过滤条件摘要自动显示为表头 tag |
| `filterParams` | `{ values?, maxValues? }` | — | set 过滤器候选值；默认从数据派生（上限 500） |

## 值与渲染

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `valueGetter` | `(p: ValueGetterParams) => TValue` | 取值（替代 field）；排序/过滤/导出一致使用 |
| `valueFormatter` | `(p: ValueFormatterParams) => any` | 显示格式化；返回非字符串自动 String() |
| `valueSetter` | `(p: ValueSetterParams) => boolean` | 写值（编辑/粘贴/填充/撤销统一入口）；返回是否变更 |
| `valueParser` | `(p: ValueParserParams<TData, TValue>) => TValue` | 同步规范编辑器、交互粘贴和导入的输入值 |
| `valueSerializer` | `(p: ValueSerializerParams<TData, TValue>) => unknown` | 同步决定剪贴板、CSV 与 typed matrix/XLSX 的输出值 |
| `status` | `boolean \| Record<string, string \| { label?: string; color?: string }>` | true 使用默认状态色；映射支持业务文字、语义色或 CSS 色，renderer 优先，仅影响展示 |
| `cellRenderer` | `(p) => string \| HTMLElement \| { el, destroy } \| string` | 自定义单元格；字符串查[注册表](/api/exports#注册表)（内置 `statusTag`/`progressBar`/`link`） |
| `cellRendererParams` | `Record<string, any>` | 渲染器参数通道（→ `params.rendererParams`），见[操作列与状态列](/recipes/action-columns) |
| `cellClass` | `string \| string[] \| (p) => …` | 附加类名 |
| `cellStyle` | `CSSObject \| (p) => CSSObject` | 动态行内样式（条件标红等；变更自动清理旧值） |
| `tooltipValueGetter` | `(p) => string \| null` | 覆盖默认 title（默认为格式化文本） |
| `wrapText` | `boolean` | 单元格自动换行（配合 `getRowHeight`） |
| `type` | `string \| string[]` | 从全局 `columnTypes` 解析一个或多个语义类型；从左到右合并，当前列字段最终覆盖 |

`ValueParserParams` 包含取值上下文 `api`、`data`、`node`、`column`、`colDef`，另有原始 `value: unknown`、`oldValue: TValue | undefined` 和 `source: "editor" | "clipboard" | "import"`。单次导入的 `parseValue` 优先于列 parser。可信的 `rows.setData()` / `rows.transact()`、清空、填充及 undo/redo 不重新解析；排序、过滤和聚合读取已有规范值。

`ValueSerializerParams` 在格式化上下文上增加 `target: "clipboard" | "csv" | "xlsx"`。未配置时，剪贴板使用显示格式，CSV 的数值保留原值、其他值使用显示格式，typed matrix 默认使用原值。两个回调都应同步且无副作用；返回 Promise 或抛错会拒绝该输入或终止该输出。异步业务校验使用 `validate` / `rowEditValidator`。详见[列值政策](/recipes/column-values)。

## 编辑

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `editable` | `boolean \| (p) => boolean` | 可编辑开关；粘贴/填充/Delete 只写可编辑格 |
| `cellEditor` | `"text" \| "number" \| "date" \| "select" \| 工厂函数 \| 注册名` | 编辑器。内置按值类型自动推断；date 编辑保留原值时间部分 |
| `cellEditorParams` | `{ values: (string \| number)[] }` | select 编辑器选项 |
| `validate` | `(newValue, p) => string \| true \| null \| undefined \| Promise<…>` | 校验：返回字符串时显示错误并拒绝该次写入；支持异步结果 |
| `singleClickEdit` | `boolean` | 列级单击编辑 |

## 选择与行

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `checkboxSelection` | `boolean` | 复选框列（`rowSelection: "single"` 时呈 radio） |
| `selectable` | `(p) => boolean` | 行级禁选；全选/分组级联自动跳过 |
| `rowDrag` | `boolean` | 行拖拽手柄列 |
| `rowGroup` | `boolean` | 作为分组字段（多列多级） |
| `aggFunc` | `string` | 聚合函数名（sum/avg/count/min/max/first/last 或 `aggFuncs` 注册的自定义） |
| `autoRowSpan` | `boolean` | 自动合并连续相同值单元格 |
| `rowSpan` | `(p) => number` | 回调式跨行数（与变高行兼容） |
| `colSpan` | `(p) => number` | 跨列数：首格宽度延伸、被覆盖格隐藏（中窗格；与列虚拟化共存时按需渲染） |
| `autoHeight` | `boolean` | 内容驱动行高：按列宽 canvas 测量换行行数（配合 `wrapText`），结果进行高缓存，仅首帧测量 |
| `initialSort` | `"asc" \| "desc"` | 初始排序 |
| `onCellClick` / `onCellDoubleClick` | `(e) => void` | 列级单元格事件 |

## ColDefGroup（多级表头）

```ts
{
  headerName: "业务信息",
  headerClass: "biz-group",
  children: [
    { field: "name", headerName: "名称" },
    { headerName: "指标", children: [{ field: "score", headerName: "分数" }] }  // 任意嵌套
  ]
}
```

- 表头行数自动 = 最大嵌套深度；分组单元格跨子列居中
- 叶子列交互（排序/过滤/拖拽/调宽）不受分组影响
- `columnDefs` 更新时分组结构随之重建（列状态按 colId 保留）

## 内置工具列模板

```ts
// 复选框列
{ colId: "sel", headerName: "", width: 40, checkboxSelection: true, pinned: "left",
  sortable: false, resizable: false, movable: false }

// 序号列（分组/明细/树形下行号只计数据行）
{ colId: "idx", headerName: "#", type: "index", width: 52 }

// 行拖拽列
{ colId: "drag", headerName: "", rowDrag: true, width: 40,
  sortable: false, resizable: false, movable: false }
```


## 内容列宽与状态颜色（0.35）

未声明 `width` 的列默认按表头和已加载数据的显示文本测宽：每列均匀抽样最多 100 行，默认 80–360px，`minWidth/maxWidth` 可覆盖。长内容在单元格内省略，表格保留内部横向滚动；不为测宽请求远程数据或执行自定义渲染器。格式化、字典及状态标签文字都参与测量。图形/操作等特殊列请指定宽度。

```ts
const columns = [
  { field: "customer", headerName: "客户", maxWidth: 280 },
  { field: "status", headerName: "状态", status: true },
  { field: "planStatus", headerName: "计划状态", status: {
    S1B: { label: "待复核", color: "danger" },
    S1C: { label: "已完成", color: "success" },
    special: { label: "特殊处理", color: "#8b5cf6" }
  } }
];
```

`status` 复用主题标签，支持 `success/warning/danger/info/neutral` 及 CSS 颜色；未知代码保持中性，`0/false` 保留。字典/formatter 的文字可参与默认语义匹配；显式 renderer 优先。状态配置只控制展示，导出继续遵循原有列值政策。

普通布局尊重显式 `width` 和拖动后的宽度；`autoWidth: false` 保留原默认 150px。显式选择 `columnLayout: "fit"` 时仍按首选宽度比例铺满，360px 限制的是内容首选宽度，实际铺满仍遵循显式 minWidth/maxWidth；配置 `flex` 则主动允许本列吸收余量。手动调宽、列状态恢复及主动 `columns.fit()` 不受自动默认上限限制。更新数据或刷新单元格会重新测量，普通布局刷新复用结果。

交互调宽会以列头文字及排序/筛选/列工具控件的所需空间为下限，鼠标和 Alt+方向键一致，避免普通列头被压盖。异常超长列头按 360px 上限保护；复杂自定义表头请显式提供 minWidth。
