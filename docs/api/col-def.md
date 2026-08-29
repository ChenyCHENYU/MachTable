# ColDef 列定义

列描述符是 MachTable 声明式配置的核心。`columnDefs` 数组的元素为 `ColDef`（叶子列）或 `ColDefGroup`（表头分组）。

## 标识与标题

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `colId` | `string` | `field` 或 `col_{i}` | 列唯一标识（排序模型/过滤模型/列状态都以它为键）。同名自动去重加后缀 |
| `field` | `string` | — | 数据取值字段，支持点路径 `a.b.c` |
| `headerName` | `string` | `field` | 表头文本 |
| `align` | `"left" \| "center" \| "right"` | 数值列自动右对齐 | 单元格内容对齐（显式设置后覆盖数值自动右对齐） |
| `headerAlign` | `"left" \| "center" \| "right"` | 跟随 `align` | 表头文本对齐（独立于单元格） |
| `headerTooltip` | `string` | — | 表头 title 提示 |
| `headerClass` | `string \| string[]` | — | 表头附加类名 |
| `headerComponent` | `(p) => string \| HTMLElement \| { el, destroy }` | — | 自定义表头内容 |

## 宽度与布局

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `width` | `number` | `150` | 固定宽度 px |
| `minWidth` / `maxWidth` | `number` | `80` / — | 拖拽与自适应的边界 |
| `flex` | `number` | `0` | 弹性权重：容器有多余空间时按权重分配 |
| `suppressSizeToFit` | `boolean` | `false` | 在 `columnLayout: "fit"` 下保持本列宽度；选择、序号、拖拽和操作列模板默认开启 |
| `pinned` | `"left" \| "right" \| boolean` | — | 固定列；`true` 等价 `"left"` |
| `hide` | `boolean` | `false` | 初始隐藏 |

## 交互开关

| 属性 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `sortable` | `boolean` | `true` | 点击表头排序（asc → desc → 无） |
| `resizable` | `boolean` | `true` | 拖拽调宽；双击把手自适应列宽 |
| `movable` | `boolean` | `true` | 拖拽表头换位（分组内或同窗格内） |
| `filter` | `boolean \| "text" \| "number" \| "date" \| "set"` | `false` | 过滤器类型；`true` 等价 `"text"`。过滤条件摘要自动显示为表头 tag |
| `filterParams` | `{ values?, maxValues? }` | — | set 过滤器候选值；默认从数据派生（上限 500） |

## 值与渲染

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `valueGetter` | `(p: ValueGetterParams) => TValue` | 取值（替代 field）；排序/过滤/导出一致使用 |
| `valueFormatter` | `(p: ValueFormatterParams) => any` | 显示格式化；返回非字符串自动 String() |
| `valueSetter` | `(p: ValueSetterParams) => boolean` | 写值（编辑/粘贴/填充/撤销统一入口）；返回是否变更 |
| `cellRenderer` | `(p) => string \| HTMLElement \| { el, destroy } \| string` | 自定义单元格；字符串查[注册表](/api/exports#注册表)（内置 `statusTag`/`progressBar`/`link`） |
| `cellRendererParams` | `Record<string, any>` | 渲染器参数通道（→ `params.rendererParams`），见[操作列与状态列](/recipes/action-columns) |
| `cellClass` | `string \| string[] \| (p) => …` | 附加类名 |
| `cellStyle` | `CSSObject \| (p) => CSSObject` | 动态行内样式（条件标红等；变更自动清理旧值） |
| `tooltipValueGetter` | `(p) => string \| null` | 覆盖默认 title（默认为格式化文本） |
| `wrapText` | `boolean` | 单元格自动换行（配合 `getRowHeight`） |
| `type` | `string \| string[]` | 从全局 `columnTypes` 解析一个或多个语义类型；从左到右合并，当前列字段最终覆盖 |

## 编辑

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `editable` | `boolean \| (p) => boolean` | 可编辑开关；粘贴/填充/Delete 只写可编辑格 |
| `cellEditor` | `"text" \| "number" \| "date" \| "select" \| 工厂函数 \| 注册名` | 编辑器。内置按值类型自动推断；date 编辑保留原值时间部分 |
| `cellEditorParams` | `{ values: (string \| number)[] }` | select 编辑器选项 |
| `validate` | `(newValue, p) => string \| true \| null` | 校验：返回字符串 = 错误提示（编辑器红框、不落库、不中断后续） |
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
{ colId: "sel", headerName: "", width: 46, checkboxSelection: true, pinned: "left",
  sortable: false, resizable: false, movable: false }

// 序号列（分组/明细/树形下行号只计数据行）
{ colId: "idx", headerName: "#", type: "index", width: 60 }

// 行拖拽列
{ colId: "drag", headerName: "", rowDrag: true, width: 40,
  sortable: false, resizable: false, movable: false }
```
