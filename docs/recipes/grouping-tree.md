# 行分组 / 树形数据

## 行分组 + 聚合

任意列声明 `rowGroup: true` 即按该列值分组（多列 = 多级）。`aggFunc` 列在分组行自动聚合。

```ts
createGrid(host, {
  columnDefs: [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true },
    { field: "workshop", headerName: "车间", rowGroup: true },      // 一级
    { field: "line", headerName: "产线", rowGroup: true },          // 二级
    { field: "product", headerName: "产品" },
    { field: "output", headerName: "产量", aggFunc: "sum", type: "rightAligned" },
    { field: "rate", headerName: "合格率", aggFunc: "avg" }
  ],
  rowData
});
```

分组行交互：

| 操作 | 行为 |
| --- | --- |
| 点击分组行（首列区域） | 展开/收起 |
| 分组行复选框 | 整组级联选中（跳过禁选行） |
| 空格键（焦点在分组行） | 展开/收起 |
| `api.expandAllGroups()` / `collapseAllGroups()` | 全部展开/收起 |

内置聚合：`sum` `avg` `count` `min` `max` `first` `last`。自定义：

```ts
createGrid(host, {
  aggFuncs: { p90: (values) => quantile(values, 0.9) },
  columnDefs: [{ field: "latency", headerName: "耗时", aggFunc: "p90" }]
});
```

分组行显示 `列名: 值 (计数)`，聚合值走该列 `valueFormatter`。

## 树形数据

```ts
createGrid(host, {
  treeData: true,
  childrenKey: "children",        // 嵌套字段名
  defaultExpandAll: false,        // 初始全展开
  autoCheckedChildren: true,      // 复选框父子级联（默认 true）
  getRowId: (p) => p.data.id,     // 树形必须提供稳定 id
  columnDefs: [
    { colId: "sel", headerName: "", width: 46, checkboxSelection: true },
    { field: "name", headerName: "名称" },     // 首个非工具列自动渲染 树形缩进 + ▶
    { field: "qty", headerName: "数量", type: "rightAligned" }
  ],
  rowData: [
    { id: "1", name: "华东", qty: 0, children: [
      { id: "1-1", name: "上海", qty: 10 },
      { id: "1-2", name: "杭州", qty: 20, children: [{ id: "1-2-1", name: "西湖区", qty: 5 }] }
    ] },
    { id: "2", name: "华南", qty: 0 }
  ]
});
```

树形语义：

| 能力 | 行为 |
| --- | --- |
| 展开/收起 | ▶ 点击或 `api.expandRow(id)` / `collapseRow(id)` / `toggleDetailRow(id)`；`expandAllDetails()` 全展开 |
| 级联勾选 | 勾选父行自动勾选全部子孙；父复选框三态（全选/半选/空） |
| 过滤 | 命中子树自动保留其祖先链（不会出现"孤儿行"） |
| 排序 | 仅同级兄弟间排序，不破坏层级 |
| 事务 | `applyTransaction({ remove: [parentNode] })` 递归删除整棵子树 |
| 序号 | 只计实际数据行 |

## 分组与树形的边界

- `treeData` 与 `rowGroup` / `masterDetail` **不支持同时启用**：控制台输出告警并忽略后者
- 分组行/树父行不可编辑（粘贴/填充自动跳过）
- 树形 + 无限滚动不支持（数据结构在服务端时请用分组或明细）

## 事件与 API

```ts
onDetailToggled: (e) => ...        // 树展开/收起也走此事件（rowId + expanded）
api.isRowExpanded("1-2");
api.getNodeById("1-2-1");          // 任意深度节点
api.forEachNode((n, i) => ...);    // 深度优先遍历全部节点
```
