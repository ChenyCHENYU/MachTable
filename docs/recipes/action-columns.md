# 操作列与状态列

后台表格最高频的两类"个性列"：右侧固定操作列（图标化按钮 + 折叠更多）与状态/进度/链接展示列。MachTable 内置预设渲染器，开箱即用且可注册名引用（配置可序列化）。

## 最简写法（预设列工厂）

```ts
import { selectionColumn, indexColumn, actionsColumn } from "@agile-team/mach-table";

columnDefs: [
  selectionColumn(),          // 左固定复选框
  indexColumn(),              // 左固定序号
  { field: "name", headerName: "名称", flex: 1 },
  { field: "status", headerName: "状态", cellRenderer: "statusTag" },
  actionsColumn({             // 右固定操作列，宽度自动估算
    actions: [
      { icon: "view", title: "查看", onClick: (p) => openDetail(p.rowNode.id) },
      { icon: "edit", title: "编辑", onClick: (p) => startEdit(p.rowNode) },
      { icon: "delete", title: "删除", danger: true, onClick: (p) => confirmRemove(p.data) }
    ]
  })
]
```

五行搭出一张标准后台列表。工厂返回普通 `ColDef`，可继续被 `columnStateKey`/列菜单管理。

## 操作列（actionButtons，手动声明）

固定右侧 + 图标按钮 + 超出折叠"更多"菜单，一步到位：

```ts
import { createActionButtonsRenderer } from "@agile-team/mach-table";

const columnDefs = [
  { field: "name", headerName: "名称", flex: 1 },
  {
    colId: "op",
    headerName: "操作",
    width: 120,                    // 建议：图标按钮数 × 26 + 16
    pinned: "right",               // 固定右侧
    sortable: false,
    resizable: false,
    movable: false,
    cellRenderer: createActionButtonsRenderer({
      max: 2,                      // 直接展示的按钮数，超出折叠为 ⋯（默认 3）
      actions: [
        { icon: "view", title: "查看", onClick: (p) => openDetail(p.rowNode.id) },
        { icon: "edit", title: "编辑", onClick: (p) => startEdit(p.rowNode) },
        { icon: "delete", title: "删除", danger: true, onClick: (p) => confirmRemove(p.data) },
        { label: "复制", onClick: (p) => copyRow(p.data) },
        {
          label: "导出",
          show: (p) => p.data.status === "done",   // 条件显示
          onClick: (p) => exportOne(p.data)
        }
      ]
    })
  }
];
```

### ActionItem

| 属性 | 说明 |
| --- | --- |
| `icon` | 内置图标名：`edit` `delete` `view` `copy` `download` `refresh` `close` `check` `plus` `search`；缺省渲染 `label` 文本按钮 |
| `label` / `title` | 文本 / tooltip |
| `danger` | 悬停变红（删除类操作） |
| `show` | `(params) => boolean` 行级条件显示 |
| `onClick` | `(params: CellRendererParams) => void`；params 含 `rowNode / data / rowIndex / api / rendererParams` |

### 交互细节

- 图标按钮 24px、悬停浮起底色；点击 `stopPropagation` 不触发行选中
- 超出 `max` 折叠为 ⋯，点击弹出菜单（外点/Esc/选择后自动关闭，danger 项红色）
- 左侧固定列同理（`pinned: "left"`），多选列 + 序号列 + 业务关键列的组合固定见[快速开始](/guide/getting-started)

## 状态列（statusTag）

```ts
{ field: "status", headerName: "状态", width: 110, cellRenderer: "statusTag" }
```

内置常见值 → 语义色映射（运行中→绿、故障→红、待机→橙、进行中→蓝……中英文均识别），渲染为**色点胶囊徽章**。未识别值显示中性灰。

自定义映射/文案：

```ts
import { createStatusTagRenderer } from "@agile-team/mach-table";

cellRenderer: createStatusTagRenderer({
  variantMap: { "custom-state": "info", 停机: "danger" },
  labelMap: { "custom-state": "自定义态" }      // 显示文案覆写（如字典码 → 中文名）
})
```

五档变体：`success / warning / danger / info / neutral`，颜色走语义令牌（`--mach-success` 等），跟随主题与暗色自动适配。

## 进度列（progressBar）

```ts
{ field: "progress", headerName: "进度", width: 140, cellRenderer: "progressBar" }
```

数值 0-100 渲染圆角进度条 + 百分比文字（自动 clamp）。配置：

```ts
import { createProgressBarRenderer } from "@agile-team/mach-table";

cellRenderer: createProgressBarRenderer({ showValue: false, unit: "%", color: "#0a7d55" })
```

## 链接列（link）

```ts
{ field: "orderNo", headerName: "订单号", cellRenderer: "link" }

// 点击行为走统一的单元格事件
onCellClicked: (e) => { if (e.colDef.cellRenderer === "link") router.push(`/order/${e.value}`); }
```

## cellRendererParams（参数通道）

内置预设与自定义渲染器共用的列级参数通道（AG 同名能力）：

```ts
{
  field: "op",
  cellRenderer: myRenderer,
  cellRendererParams: { anything: true }     // → params.rendererParams
}

myRenderer = (params) => { params.rendererParams.anything; /* true */ }
```

回调无法 JSON 序列化的场景（如 onClick），配置整体仍可用 `createActionButtonsRenderer` 工厂在代码侧组装后按注册名复用。

## 注册复用（低代码/多表统一）

```ts
// 应用入口注册一次，全部表格共用
import { registerCellRenderer, createActionButtonsRenderer } from "@agile-team/mach-table";

const ops = createActionButtonsRenderer({ actions: [...] });
registerCellRenderer("table-ops", ops);

// 任意列配置（可来自 Schema JSON）
{ colId: "op", cellRenderer: "table-ops", pinned: "right", width: 120 }
```

内置注册名：`statusTag` / `progressBar` / `link`（随第一个 grid 实例自动注册）。

## 完整示例（后台列表页典型列组）

```ts
const columnDefs: ColDef<Row>[] = [
  { colId: "sel",  headerName: "", width: 46, pinned: "left", checkboxSelection: true, sortable: false, resizable: false, movable: false },
  { colId: "idx",  headerName: "#", type: "index", width: 60, pinned: "left", sortable: false, resizable: false, movable: false },
  { field: "orderNo", headerName: "订单号", width: 140, pinned: "left", cellRenderer: "link" },
  { field: "customer", headerName: "客户", flex: 1 },
  { field: "status", headerName: "状态", width: 110, cellRenderer: "statusTag" },
  { field: "progress", headerName: "进度", width: 140, cellRenderer: "progressBar" },
  { field: "amount", headerName: "金额", width: 120, aggFunc: "sum", type: "rightAligned" },
  { colId: "op", headerName: "操作", width: 120, pinned: "right", sortable: false, resizable: false, movable: false,
    cellRenderer: "table-ops" }
];
```

左固定（选择 + 序号 + 订单号）/ 右固定（操作），横向滚动时业务列滚动、框架列恒定可见。
