# 行选择

## 基础：多选

```ts
createGrid(host, {
  columnDefs: [
    {
      colId: "sel", headerName: "", width: 46, pinned: "left",
      checkboxSelection: true,
      sortable: false, resizable: false, movable: false
    },
    { field: "name", headerName: "名称" }
  ],
  rowData,
  rowSelection: "multiple",        // 开启后行点击也可选中（Ctrl 加选、Shift 范围）
  rowKey: "id"
});
```

交互一览：

| 操作 | 行为 |
| --- | --- |
| 点击行 / 复选框 | 单选该行 |
| Ctrl(Win) / Cmd(Mac) + 点击 | 加选/减选 |
| Shift + 点击 | 从锚点行到当前行范围选 |
| 表头复选框 | 全选当前过滤结果（半选态表示部分选中） |
| 空格键 | 选中焦点行 |
| Ctrl/Cmd + A | 全选 |

## 单选（radio 形态）

```ts
rowSelection: "single"
```

复选框列自动渲染为 radio；点击新行自动取消旧行；再次点击已选行保持选中。

## 行级禁选

```ts
{
  colId: "sel", checkboxSelection: true,
  selectable: (p) => p.data.status !== "locked"   // 锁定行禁用复选框
}
```

禁选行：复选框 disabled、点击行不选中、`selectAll` / 分组级联 / 树形级联自动跳过。

## 编程式 API

```ts
api.selection.getRows();                     // 数据数组（含被过滤隐藏的选中行）
api.selection.getNodes();                      // 行节点
api.selection.getIds();                        // id 数组（无限模式未加载行也在内）
api.selection.getVisibleRows();                   // 仅当前过滤可见的选中行

api.selection.setById("r5");                    // 选中（默认清除其他）
api.selection.setById("r6", true, false);       // 选中且不清除其他
api.selection.setRows([rowA, rowB]);              // 按数据引用批量选中
api.selection.selectAll(true);                         // 全选过滤结果
api.selection.clear();
```

## 与过滤/排序/数据替换的交互

| 场景 | 行为 |
| --- | --- |
| 过滤隐藏选中行 | 选中保留（`api.selection.getRows()` 仍返回） |
| 排序 | 选中跟随数据行 |
| `rows.setData` 全量替换 | 有稳定 `rowKey`：按 id 保留选中；无：清空 |
| `api.rows.transact({ remove })` | 选中随行删除 |
| 无限滚动翻块 / reload | 按 id 跨块保留 |

## 树形级联与分组级联

```ts
// 树形：勾选父节点自动勾选全部子孙；父复选框三态（全选/半选/空）
{ treeData: true, autoCheckedChildren: true /* 默认 */, rowSelection: "multiple" }

// 行分组：分组行复选框一键选中整组（跳过禁选行）
{ /* rowGroup 列 + multiple */ }
```

## 事件监听

```ts
onSelectionChanged: (e) => {
  console.log(e.selectedRows.length, e.selectedNodes.map((n) => n.id));
}
```

## 常见问题

**Q：为什么 `rowSelection: "multiple"` 后没有复选框？**
复选框由 `checkboxSelection` 列声明决定；`rowSelection` 只控制选中行为。两者都配置才有复选框列。

**Q：跨页（无限模式）全选了 50 行，表头为什么是半选？**
表头全选态以服务端总行数为分母；已加载行全选时呈半选。用 `api.selection.getIds()` 获取完整选中集合。

**Q：不想让点击行选中，只要复选框？**
暂不支持分离（可监听 `rowClicked` 忽略）；该行为与 AG Grid 一致。
