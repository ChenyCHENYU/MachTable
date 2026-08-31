# GridApi

`createGrid()`、Vue `useMachTable()` 与 React `useMachTable()` 返回同一套领域化 API。根级只负责生命周期、配置、事件和批处理；表格命令按职责归入 12 个只读领域。API 与各领域对象均被冻结，不能被页面意外改写。

```ts
api.rows.transact({ update: changedRows });
api.filtering.setQuickText("pending");
await api.editing.save(orderApi.saveChanges);
```

## 根级能力

| 方法 | 说明 |
| --- | --- |
| `batch(callback)` | 合并回调内的模型、布局和渲染更新；嵌套调用安全 |
| `whenReady()` | 首次布局和 `gridReady` 后返回当前 API |
| `getOption(key)` | 读取应用配置、预设和实例 props 合并后的当前值 |
| `updateOptions(patch)` | 原子校验并更新配置；一次 patch 最多提交一次视觉刷新 |
| `on(event, listener)` | 订阅事件并返回解除函数 |
| `destroy()` | 释放观察器、监听器、计时器、编辑器和远程请求；可重复调用 |
| `isDestroyed()` | 是否已销毁 |

```ts
const off = api.on("selectionChanged", ({ selectedRows }) => {
  console.log(selectedRows.length);
});
off();
```

## `api.rows`

| 方法 | 说明 |
| --- | --- |
| `setData(rows)` | 全量替换本地数据；稳定 `rowKey` 可保留选择语义 |
| `transact({ add?, addIndex?, remove?, update? })` | 同步增量事务 |
| `transactAsync(transaction, { signal? })` | 合并到异步事务队列，可取消 |
| `flushTransactions()` | 立即提交待处理异步事务 |
| `getCount()` | 当前展示行数 |
| `getAt(index)` / `getById(id)` | 按展示索引或稳定 ID 取 RowNode |
| `forEach(callback)` | 遍历当前 RowModel |
| `forEachDisplayed(callback)` | 遍历过滤、排序后的展示行 |
| `reorder(fromIndex, toIndex)` | 本地行重排，成功返回 `true` |
| `isRemote()` | 是否使用远程数据源 |
| `reload({ signal? })` | 重载远程数据 |
| `ensureLoaded(start, end, { signal? })` | 确保随机块区间已加载 |
| `purgeCache()` | 清空远程块缓存 |
| `getCacheSnapshot()` | 返回有界缓存、命中、淘汰和请求队列诊断 |

## `api.columns`

| 方法 | 说明 |
| --- | --- |
| `getDefinitions()` / `setDefinitions(defs)` | 读取或替换列定义 |
| `getState()` / `setState(state)` / `resetState()` | 列状态快照、恢复和重置 |
| `setVisible(colId, visible)` | 设置显隐 |
| `setPinned(colId, side)` | 固定到左/右或取消固定 |
| `move(colId, toIndex)` | 调整列顺序 |
| `setWidth(colId, width)` | 程序化调整宽度，成功返回 `true` |
| `fit(width?)` | 按容器或指定宽度缩放列 |
| `autoSize(colId, skipHeader?)` / `autoSizeAll(skipHeader?)` | 按内容自动宽度 |
| `getWorkbenchItems()` | 获取无 UI 绑定的列工作台模型 |
| `openWorkbench(anchor?)` / `closeWorkbench()` | 打开/关闭内置列工作台 |

交互式列宽调整必须显式配置 `enableColumnResize: true`。程序化 `setWidth()` 不受该开关限制。

## `api.selection`

| 方法 | 说明 |
| --- | --- |
| `getRows()` / `getNodes()` / `getIds()` | 全部已选行、节点或 ID |
| `getVisibleRows()` | 当前已加载且可见的已选行 |
| `setRows(rows, clearOthers?)` | 按行对象设置选择 |
| `setById(id, selected?, clearOthers?)` | 按稳定 ID 选择/取消 |
| `selectAll(filteredOnly?)` | 选择全部或过滤结果 |
| `clear()` | 清空行选择 |
| `getMode()` / `setMode(mode)` | 获取/设置单选、多选或关闭 |
| `getRange()` / `clearRange()` | 获取或清空单元格范围选择 |

远程“全选全部查询结果”由框架 `/workflows` 的 `useMachTableQuery()` 表达为 `allMatching + excludedKeys`，不会要求客户端加载全部 ID。

## `api.editing`

| 方法 | 说明 |
| --- | --- |
| `startCell({ rowIndex, colId, keyPress? })` | 开始单元格编辑 |
| `startRow(rowIndex)` | 开始原子整行编辑 |
| `isRowActive(rowIndex?)` | 判断指定行或任意行是否编辑中 |
| `stop({ cancel? })` | 异步提交或取消当前编辑；校验失败返回 `false` |
| `getChanges()` / `getDirtyRowIds()` | 获取待保存变更或脏行 ID |
| `markSaved(rowIds?)` | 确认指定或全部当前变更 |
| `rollback(rowIds?)` | 回滚指定或全部脏行 |
| `save(handler, rowIds?)` | 快照化保存，返回提交、成功、失败和冲突明细 |
| `undo()` / `redo()` | 撤销/重做最近一次可逆编辑 |
| `canUndo()` / `canRedo()` | 是否可撤销/重做 |

`save()` 返回：

```ts
interface GridBatchSaveResult<T> {
  submitted: GridChange<T>[];
  saved: GridChange<T>[];
  failures: SaveChangeIssue[];
  conflicts: SaveChangeConflict<T>[];
}
```

保存开始后产生的新编辑不会被旧请求误清除。参见[批量保存与冲突](/recipes/batch-save)。

## `api.filtering` 与 `api.sorting`

| 方法 | 说明 |
| --- | --- |
| `filtering.getModel()` / `setModel(model)` | 普通列过滤模型 |
| `filtering.getAdvancedModel()` / `setAdvancedModel(model)` | 可序列化高级过滤 AST |
| `filtering.getQuickText()` / `setQuickText(text)` | 全局快速搜索 |
| `filtering.isPresent(colId?)` | 指定列或全局是否存在过滤 |
| `sorting.getModel()` / `setModel(model)` | 排序模型 |

## `api.pagination`

| 方法 | 说明 |
| --- | --- |
| `isEnabled()` / `setEnabled(enabled)` | 分页开关 |
| `getPage()` / `setPage(page)` | 页码（从 1 开始） |
| `getPageSize()` / `setPageSize(size)` | 每页数量 |
| `getPageCount()` | 总页数 |
| `getTotalRowCount()` | 当前已知总量 |

## `api.hierarchy`

| 方法 | 说明 |
| --- | --- |
| `isRowExpanded(id)` / `setRowExpanded(id, expanded)` | 树节点展开状态 |
| `isTreeRowLoading(id)` | 懒加载子节点是否请求中 |
| `loadTreeChildren(id, { force? })` | 加载子节点；`force` 用于显式重试 |
| `isGroupExpanded(id)` / `setGroupExpanded(id, expanded)` | 分组展开状态 |
| `setAllGroupsExpanded(expanded)` | 展开/折叠全部分组 |
| `setAllDetailsExpanded(expanded)` | 展开/折叠全部主从详情 |

## `api.view`

| 方法 | 说明 |
| --- | --- |
| `getRoot()` | 内部 grid 根元素；未挂载/已销毁为 `null` |
| `scrollToRow(index, position?)` | 滚动到行，可选 `top/bottom/middle/nearest` |
| `refreshCells(params?)` | 精确刷新行、列、固定行；`force` 可重建 renderer |
| `refreshLayout()` | 重新测量容器并布局 |
| `flush()` | 立即提交当前计划中的视图更新 |
| `setOverlay("loading" | "noRows" | "error" | null)` | 显式覆盖层 |
| `getPinnedRows(position)` / `setPinnedRows(position, rows)` | 顶部/底部固定行 |

## `api.state`

| 方法 | 说明 |
| --- | --- |
| `get()` | 获取版本化 `GridState` |
| `apply(state, { sections?, emitEvents? })` | 原子恢复全部或指定状态区段 |

可选区段：`columns`、`sort`、`filter`、`pagination`、`selection`、`expansion`。自动持久化使用同一契约：

```ts
persistence: {
  key: "tenant:user:orders",
  sections: ["columns"],
  debounceMs: 160,
  store: customStore
}
```

## `api.io`

| 方法 | 说明 |
| --- | --- |
| `exportCsv(params?)` | 生成 CSV 字符串，默认防公式注入 |
| `importCsv(text, options?)` | 替换、追加或粘贴导入 |
| `print(options?)` | 打印当前表格 |
| `copyRange()` | 将当前范围复制到剪贴板 |

XLSX 通过独立的 `@agile-team/mach-table-xlsx` 扩展提供，不进入 Core。

## `api.diagnostics`

| 方法 | 说明 |
| --- | --- |
| `get()` | 实例状态、活动 Feature、近期错误、远程/渲染/更新统计 |
| `getPerformance()` | 渲染、布局、模型、DOM 数量、长任务和堆内存快照 |
| `resetPerformance()` | 重置当前实例性能样本 |

诊断 API 用于开发、测试和遥测采样，不应用来驱动业务状态。
