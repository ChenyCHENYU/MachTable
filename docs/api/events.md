# 事件 Events

事件双通道：`options.onXxx` 回调 与 `api.addEventListener(type, fn)`（返回取消函数）。所有事件对象都含 `type` 与 `api` 字段。

## 生命周期

### `gridReady`

```ts
onGridReady: (e) => { /* grid 可交互，e.api 即命令接口 */ }
```

### `gridDestroyed`

`api.destroy()` 执行时触发，此后不可再交互。

### `modelUpdated`

数据管道（过滤/排序/分组/无限块到达）刷新后触发。

```ts
{ type: "modelUpdated", rowCount: number }
```

### `gridError`

用户 formatter/renderer/getter/setter、数据源、持久化存储或事件回调抛错时触发；错误会被隔离，表格继续完成当前刷新或销毁流程。

```ts
{
  type: "gridError",
  code: "DATA_SOURCE_ERROR" | "DATA_INTEGRITY_ERROR" | "VALIDATION_ERROR" |
        "RENDERER_ERROR" | "EDITOR_ERROR" | "FEATURE_ERROR" | "STATE_ERROR" |
        "EVENT_HANDLER_ERROR" | "GRID_ERROR",
  error: unknown,
  source: string,
  context?: Record<string, unknown>
}
```

业务监控应优先按稳定 `code` 聚合，`source` 用于更细粒度定位。

## 单元格 / 行

| 事件 | 载荷 | 触发时机 |
| --- | --- | --- |
| `cellClicked` | `event, rowNode, rowIndex, column, colDef, value` | 单击单元格（含列级 `onCellClick` 先于事件） |
| `cellDoubleClicked` | 同上 | 双击（若可编辑，随后自动进入编辑） |
| `cellContextMenu` | 同上 | 右键（`contextMenu: true` 时同时弹内置菜单） |
| `rowClicked` | `event, rowNode, rowIndex` | 单击行任意位置 |
| `rowDoubleClicked` | 同上 | 双击行 |

## 选择

### `selectionChanged`

```ts
{ selectedNodes: RowNode[], selectedRows: TData[] }
```

树形级联/分组级联/`setSelection`/`selectAll` 等一切选择变化均触发一次。

## 排序 / 过滤

| 事件 | 载荷 |
| --- | --- |
| `sortChanged` | `{ sortModel: { colId, direction }[] }` |
| `filterChanged` | `{ filterModel: FilterModel, advancedFilterModel: AdvancedFilterModel \| null }`（普通列、高级表达式或 quickFilter 变化） |

## 列

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `columnResized` | `{ colId, width, finished }` | 拖拽帧为 `finished: false`，松手、键盘或 API 提交为 `true`；自动持久化只响应完成事件 |
| `columnMoved` | `{ colId, toIndex }` | 拖拽换位完成 |
| `columnVisibilityChanged` | `{ colId, visible }` | 显示/隐藏切换 |
| `displayedColumnsChanged` | `{}` | 列结构整体变化（defs 更新/状态应用） |

## 编辑

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `cellEditingStarted` | `{ rowIndex, colId, rowNode }` | 编辑器挂载 |
| `cellEditingStopped` | `{ rowIndex, colId, rowNode, oldValue, newValue }` | 编辑结束（取消时 newValue = oldValue） |
| `rowEditingStarted` | `{ rowIndex, rowNode, data }` | 整行草稿编辑开始 |
| `rowEditingStopped` | `{ rowIndex, rowNode, data, cancelled, changes }` | 整行提交或取消；changes 为成功提交的列级差异 |
| `cellValueChanged` | `{ oldValue, newValue, rowNode, rowIndex, column, colDef, data }` | 值落库。编辑/粘贴/填充/清除/剪切/**undo/redo** 统一经此事件 |
| `dirtyStateChanged` | `{ dirtyRowIds }` | 脏数据集合变化、保存确认或回滚后触发 |

## 范围与拖拽

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `rangeSelectionChanged` | `{ range: { row1, row2, colId1, colId2 } \| null }` | 框选范围变化/取消 |
| `rowDragEnd` | `{ rowNode, fromIndex, toIndex }` | 行拖拽松手（`applyRowDrag: false` 时自行处理数据） |

## 明细

### `detailToggled`

```ts
{ rowId: string, rowNode: RowNode, expanded: boolean }
```

### `treeChildrenLoaded` / `treeChildrenLoadFailed`

懒加载树节点成功或失败时触发。成功事件包含 `rowId`、`rowNode` 与 `children`；失败事件包含 `error`。失败同时进入统一 `gridError`，错误码为 `DATA_SOURCE_ERROR`。

## 分页

### `paginationChanged`

```ts
{ page, pageSize, pageCount, total }
```

翻页 / 每页条数变化 / 运行时开关时触发。

## 使用示例

```ts
// 方式一：options 回调
createGrid(host, {
  onSelectionChanged: (e) => saveDraft(e.selectedRows),
  onCellValueChanged: (e) => audit(e.colDef.field, e.oldValue, e.newValue)
});

// 方式二：addEventListener（返回取消函数）
const off = api.addEventListener("rangeSelectionChanged", (e) => {
  console.log("框选", e.range);
});
off(); // 取消订阅

// 方式三：Vue 模板（kebab-case）
<MachTable @cell-value-changed="onChanged" @detail-toggled="onDetail" />
```
