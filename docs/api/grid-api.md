# GridApi 命令接口

`createGrid` 返回值 / `onGridReady` 的 `e.api` / Vue `ref.getApi()` / React `apiRef.current`。共 60+ 方法，按类别列出。

## 数据

| 方法 | 说明 |
| --- | --- |
| `setRowData(rows)` | 全量替换（清空撤销栈；有 `getRowId` 时选中态按 id 保留） |
| `getRootElement()` | 返回当前表格根元素，销毁后为 `null`；用于 Portal、测量和自定义全屏目标 |
| `applyTransaction({ add?, addIndex?, remove?, update? })` | 增量事务。remove 按行引用或 `getRowId` 匹配；树形 remove 递归删整棵子树；update 后局部刷新 |
| `applyTransactionAsync(transaction): Promise<void>` | 高频事务排队；默认 16ms 内按调用顺序合并并只刷新一次数据管线 |
| `flushAsyncTransactions()` | 立即提交队列，不等待时间窗 |
| `reload(): Promise<void>` | 无限模式重新从第 0 行加载并等待首块完成；客户端模式重放 rowData |
| `isInfinite()` | 是否无限滚动模式 |
| `importCsv(text, { mode?, separator?, headerRowIndex? })` | CSV 导入：`replace` 替换 / `append` 追加 / `paste` 走粘贴管线（可撤销），表头自动映射列，数值自动转型 |
| `print({ title?, includeHeader? })` | 新窗口打印全部数据（跨页、过滤排序后），弹窗被拦截返回 false |
| `getDisplayedRowCount()` | 当前展示行数（分页开启时为当前页行数） |
| `getTotalRowCount()` | 过滤排序后的总行数（分页开启时分母） |
| `getRowNode(rowIndex)` / `getNodeById(id)` | 行节点查询 |
| `forEachNode(cb)` / `forEachNodeAfterFilterAndSort(cb)` | 遍历全部 / 过滤排序后（跨页全量，跳过分组与明细占位） |

## 列

| 方法 | 说明 |
| --- | --- |
| `setColumnDefs(defs)` | 更新列定义（列宽/顺序/显隐/排序状态按 colId 保留） |
| `getColumnDefs()` | 取当前 defs |
| `getColumnState()` / `setColumnState(state)` / `resetColumnState()` | 列状态读写与重置（含 width/flex/widthMode/hide/pinned/sort/sortIndex） |
| `setColumnVisibility(colId, visible)` | 显示/隐藏列 |
| `moveColumn(colId, toIndex)` | 编程式移动（同窗格/同分组内） |
| `setColumnPinned(colId, "left" \| "right" \| null)` | 固定/取消固定 |
| `setColumnWidth(colId, width)` | 安全设置单列宽度并触发统一事件/持久化；非法宽度或未知列返回 `false` |
| `sizeColumnsToFit(width?)` | 按比例铺满容器 |
| `autoSizeColumn(colId, skipHeader?)` / `autoSizeAllColumns(skipHeader?)` | 内容自适应列宽（Canvas 测量，取样前 2000 行） |
| `openColumnWorkbench(anchor?)` / `closeColumnWorkbench()` | 打开/关闭可搜索的列工作台（显隐、固定、排序、自适应、重置） |
| `getColumnWorkbenchItems()` | 读取自定义列工作台所需的 `colId/label/visible/pinned/width/movable/hideable` |
| `openColumnPanel(anchor?)` | 0.x 兼容别名；新代码使用 `openColumnWorkbench()` |

## 排序 / 过滤 / 分页

| 方法 | 说明 |
| --- | --- |
| `setSortModel([{ colId, direction }])` / `getSortModel()` | 排序模型读写（表头指示器同步） |
| `setFilterModel(model)` / `getFilterModel()` | 列过滤模型读写；`null` 清空。模型结构见[排序与过滤](/recipes/sorting-filtering) |
| `setAdvancedFilterModel(model)` / `getAdvancedFilterModel()` | 嵌套 AND/OR/NOT 表达式读写；`null` 清空。见[高级过滤](/recipes/advanced-filter) |
| `isColumnFilterPresent(colId)` | 某列是否有过滤 |
| `setQuickFilter(text)` / `getQuickFilter()` | 全局快速过滤 |
| `paginationEnabled()` / `setPaginationEnabled(bool)` | 内置分页开关（无数据自动隐藏，见[分页配方](/recipes/pagination-io)） |
| `getPage()` / `setPage(n)` / `getPageCount()` | 页码读写 |
| `getPageSize()` / `setPageSize(n)` | 每页条数（切换保持首个可见行所在页） |
| `getTotalRowCount()` | 总行数 |

## 选择

| 方法 | 说明 |
| --- | --- |
| `getSelectedNodes()` / `getSelectedRows()` | 选中行（含被过滤隐藏的） |
| `getSelectedIds()` | 选中行 id 列表（无限模式未加载行也在内） |
| `selectNodeById(id, selected?, clearOthers?)` | 按 id 勾选 |
| `setSelection(rows, clearOthers?)` | 按数据引用/id 批量选中 |
| `getVisibleSelection()` | 仅当前过滤可见的选中行 |
| `selectAll(filteredOnly?)` / `deselectAll()` | 全选（跳过禁选行）/ 清空 |
| `setRowSelection(mode)` / `getRowSelection()` | 运行时切换选择模式 |

## 编辑与撤销

| 方法 | 说明 |
| --- | --- |
| `startEditingCell({ rowIndex, colId, keyPress? })` | 编程式进入编辑（返回是否成功） |
| `startEditingRow(rowIndex)` | 暂存式整行编辑；所有可编辑格挂载编辑器，返回是否成功 |
| `isRowEditing(rowIndex?)` | 查询当前是否有整行编辑，或指定显示行是否正在编辑 |
| `stopEditing(cancel?)` | 结束编辑；兼容同步调用。异步校验时不阻塞调用栈 |
| `stopEditingAsync(cancel?): Promise<boolean>` | 等待同步/异步校验；成功结束返回 `true`，校验失败保持编辑并返回 `false` |
| `stopEditingRow(cancel?): Promise<boolean>` | 整行提交/取消；提交时全部校验通过后统一写值，并形成一个 undo 批次 |
| `getDirtyRowIds()` / `getChanges()` | 查询尚未确认保存的行和逐单元格原值/当前值 |
| `saveChanges(handler, rowIds?)` | 兼容简写：把稳定快照交给保存函数并返回成功确认的修改；保留请求期间产生的新编辑 |
| `saveChangesDetailed(handler, rowIds?)` | 返回 `{ submitted, saved, failures, conflicts }`，用于部分成功、逐行校验和乐观锁冲突；见[批量保存](/recipes/batch-save) |
| `markChangesSaved(rowIds?)` | 业务已自行保存时手动确认 |
| `rollbackChanges(rowIds?)` | 回滚全部或指定行到最近已确认值 |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | 撤销栈操作，见[配方](/recipes/undo-redo) |

## 固定行 / 分组 / 树 / 明细

| 方法 | 说明 |
| --- | --- |
| `setPinnedTopRowData(rows)` / `getPinnedTopRowData()` | 固定首行读写 |
| `setPinnedBottomRowData(rows)` / `getPinnedBottomRowData()` | 固定末行读写 |
| `toggleRowGroup(groupId)` / `isGroupExpanded(groupId)` | 分组行展开切换 |
| `expandAllGroups()` / `collapseAllGroups()` | 全部分组展开/收起 |
| `expandRow(id)` / `collapseRow(id)` / `toggleDetailRow(id)` / `isRowExpanded(id)` | 明细/树节点展开 |
| `loadTreeChildren(id, { force? })` / `retryTreeChildren(id)` | 加载或强制重试懒加载树子级；并发请求自动去重 |
| `isTreeRowLoading(id)` | 查询节点子级是否正在加载 |
| `expandAllDetails()` / `collapseAllDetails()` | 全部展开/收起（树与明细通用） |
| `reorderRows(fromIndex, toIndex)` | 编程式行重排（触发 `rowDragEnd` 同语义） |

## 范围 / 剪贴板

| 方法 | 说明 |
| --- | --- |
| `getRangeSelection()` / `clearRangeSelection()` | 框选范围 `{ row1, row2, colId1, colId2 }` 读写 |
| `copyRangeToClipboard()` | 复制当前范围（或焦点格）为 TSV，返回 Promise\<boolean\> |

## 视图与导出

| 方法 | 说明 |
| --- | --- |
| `scrollToIndex(rowIndex, position?)` | 滚动到行（top/bottom/middle/nearest，变高行精确） |
| `refreshCells()` | 强制重渲染可见单元格 + 固定行 + 合计行 |
| `refreshLayout()` | 重测量尺寸（弹窗/Tab 切换后调用） |
| `updateOptions(partial)` | 运行时改配置（尺寸/视觉/行为类选项） |
| `setOverlay("loading" \| "noRows" \| null)` / `hideOverlays()` | 覆盖层控制 |
| `getDataAsCsv(params?)` | CSV 导出；参数 `{ includeHeader, columnSeparator, prependBOM, onlySelected, protectFormulas }`，默认防公式注入 |

## 事件与生命周期

| 方法 | 说明 |
| --- | --- |
| `addEventListener(type, fn)` | 订阅，返回取消函数 |
| `removeEventListener(type, fn)` | 取消订阅 |
| `whenReady(): Promise<GridApi>` | 首次布局帧与 `gridReady` 完成后 resolve；Vue/React Hook 的 `ready` 基于它 |
| `getState()` / `applyState(state, options?)` | 读取/恢复 GridState v2；自动迁移 v1，输入先有界归一化；`emitEvents: false` 可静默恢复 |
| `getDiagnostics()` | 返回版本、加载/虚拟 DOM/行列/选择/脏数据、Feature 清单、性能和最近结构化错误，不包含业务行数据 |
| `getPerformanceSnapshot()` / `resetPerformanceMetrics()` | 读取/清空最近 120 次视口渲染的平均、P95、最大耗时、长帧和实际渲染范围 |
| `destroy()` / `isDestroyed()` | 销毁 / 状态查询 |
