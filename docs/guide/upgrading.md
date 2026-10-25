# 升级指南

MachTable 尚处于 0.x，minor 版本可能包含有意的契约整理。升级前阅读本页与各包 Changelog，并在业务预发布环境回归。

```bash
pnpm up @agile-team/mach-table-vue@^0.32.0
# 或
pnpm up @agile-team/mach-table-react@^0.32.0
```

## 0.31.2 → 0.32.0

现有根入口、领域 API 和单行托管排序接入保持兼容。新增能力显式从 `/workbench`、`/preferences`、`/ordering`、`/server-side`、`/analysis`、`/multi-range` 导入；Vue/React 从对应适配包的同名子路径导入，继续只安装一个包。

- 过滤/修改审阅/诊断和分析 UI 引入 `/styles/workbench.css`，服务端分组控件引入 `/styles/server-side.css`；原有 `styles.css`/`styles/mach-table.css` 路径保持有效。
- 新增 `rowDragPolicy` 行级与目标判定。高级多行/树排序由 `createRowOrderController().bindings` 接入，复用默认手柄及主题；普通托管排序的旧事件下标语义保持不变。
- 排序控制器 `undo()`/`redo()` 与移动共用保存通道和版本检查。保存端须原子处理 `context.operations` 全批次或 `context.plan.after`；旧的单意图 transport 只支持普通移动，不会自动实现复杂撤销。
- 服务端 Store 是显式 route 分页的数据模型，绑定时接管手动排序/过滤和客户端分页；不能与原有 datasource 或查询工作流同时绑定同一表格。有编辑或未保存数据时新投影等待显示，保存/回滚/取消后继续。
- 状态默认仍严格接受 v2；历史 v1、字段重命名、删除和过滤类型变化通过可选偏好适配器显式迁移并报告。切换账号须创建新 store，不能复用已绑定旧身份的实例。
- Vue KeepAlive 停用会关闭临时编辑/弹层与拖拽，保留模型、脏数据、选择和滚动；重新激活只恢复布局，不抢占页面其他输入的焦点。
- Pivot、公式及多范围有明确资源上限，超限报告错误，不截断为伪完整结果。远程分析限定已加载视图；多业务 UAT、人工读屏与双边性能比较不由自动测试代替。

详见[按需工作台](../recipes/workbench.md)、[排序](../recipes/row-presentation.md)、[企业偏好](../recipes/enterprise-preferences.md)、[服务端 Store](../recipes/server-side-store.md)、[分析](../recipes/analysis.md)、[多范围](../recipes/multi-range.md)。

## 0.31.1 → 0.31.2

公共 API 与配置无需迁移。粘贴、清空、填充现在与编辑器一样执行已有列 `validate` 和整行 `rowEditValidator`；批量输入按行拒绝无效数据，有效行形成一条撤销记录。旧版本依赖“粘贴绕过校验”的逻辑应移除；可信数据更新继续使用 `rows.transact()`。

随机块淘汰会保留未保存行供保存/回滚；渲染、焦点和编辑块所需范围可临时超过 `maxBlocksInCache`，上界为保护块数加一个取数槽。完整 `rows.setData()`、`reload()`、`purgeCache()` 和远程查询切换会清空旧作用域的脏状态与撤销历史。异步输入/保存不会写入同 ID 的新记录。Vue/React 编辑工作流隔离过期保存结果和冲突，React 查询也修正 StrictMode 与同值搜索的重复请求。详见[剪贴板](/recipes/clipboard)、[随机块缓存](/recipes/random-access-datasource)与[批量保存](/recipes/batch-save)。

## 0.31.0 → 0.31.1

修正 Vue 表格按 key 重建时组件 ref 可能早于 mounted 执行的问题。`useMachTable()` 与 `useMachTableController()` 会在挂载完成后绑定新 API，正确同步 ready、选择状态和工具栏命令；已替换或卸载实例的延迟任务不会回写。页面配置无需迁移。

## 0.30.1 → 0.31.0

新增可选 `rowStyleRules`，不配置时沿用原有样式。`dragColumn()` 默认固定左侧并固定工具列宽；可用 overrides 调整。自动拖拽与 `rows.reorder()` 在列排序、分组、树、远程和 dataProcessor 模式下会拒绝重排；外部维护顺序的扁平数据请使用 `applyRowDrag: false`。`rowDragEnd` 现在在自动移动完成后发出，新增 `targetIndex`（最终下标）和 `applied`；保留旧 `toIndex` 插入边界语义。依赖回调前读取旧顺序的代码需要调整。详见[行拖拽与条件整行颜色](/recipes/row-presentation)。

## 0.30.0 → 0.30.1

修正固定列宽被重复扣除造成的留白。`columnLayout: "fit"` 继续按定义比例填满容器，`autoSize()` / `autoSizeAll()` 的测量结果保留为响应式内容基准；旧手动宽度仍保持固定。`columns.fit()` 保留固定列及 `suppressSizeToFit` 列，在 `fit` 模式下恢复自动列的响应性。正常布局模式行为不变，业务无需增加 ResizeObserver 或 ready 回调。详见[列状态与内容自适应](/recipes/column-state)。

## 0.29.2 → 0.30.0

0.30.0 仅增加 `createRemoteExportRequest()` 辅助函数，不改变 `GridApi`、`GridOptions` 或既有渲染、编辑、CSV/XLSX 与工具栏的默认行为。现有页面可直接升级，无需迁移配置。服务端全量导出按[导出配方](/recipes/remote-export)由业务显式接入。

## 0.25 → 0.28

0.28 是稳定性治理版本，没有新增、删除或改名公共 API，也不要求修改现有 Vue/React 页面：

- 31 项历史圈复杂度豁免已全部清零，所有生产函数统一受 `15` 的门禁约束。
- 配置解析、布局、渲染、选择、筛选、编辑动作和交互事件按职责拆分，公共 API 快照保持不变。
- 集合筛选在搜索后会保留不可见选项的已选状态，并正确区分同文本的数字/字符串/空值；列菜单按下不再进入列拖拽路径。
- 直接把框架适配包升级到 `^0.29.2` 即可；无需额外安装 Core，也无需迁移配置文件。

## 0.24 → 0.25

0.25 是正式接入前的契约终审版本：

- `persistence.sections` 现在同时限制写入与恢复；`columns` 不再隐式携带排序，异步 store 写入保持顺序并合并为最新快照。
- `useMachTableQuery().reset()` 同时清空普通、高级和快速过滤，且只发起一次请求。
- 应用配置中的事件观察器会与 Vue 页面监听器/React 组件回调各执行一次。
- Vue 全局 `MachTableToolbar` 类型只在导入 `/ui` 后生效，与可选插件的实际注册边界一致。
- `ActionItem.danger` 改为唯一入口 `variant: "danger"`；暗色配置统一使用 `theme: "dark"`，不再从 `className` 推断。

## 0.23 → 0.24

0.24 在正式规模接入前完成 API 收口，不保留重复/旧名称的兼容层。核心能力没有被删除，而是归入唯一入口。

### 1. 平面 GridApi 改为领域 API

| 0.23 调用 | 0.24 调用 |
| --- | --- |
| `api.setRowData(rows)` | `api.rows.setData(rows)` |
| `api.applyTransaction(tx)` | `api.rows.transact(tx)` |
| `api.getSelectedRows()` | `api.selection.getRows()` |
| `api.setColumnWidth(id, width)` | `api.columns.setWidth(id, width)` |
| `api.openColumnWorkbench()` | `api.columns.openWorkbench()` |
| `api.setQuickFilter(text)` | `api.filtering.setQuickText(text)` |
| `api.getState()` / `applyState()` | `api.state.get()` / `api.state.apply()` |
| `api.saveChangesDetailed(handler)` | `api.editing.save(handler)` |
| `api.undo()` / `redo()` | `api.editing.undo()` / `api.editing.redo()` |
| `api.getDataAsCsv()` | `api.io.exportCsv()` |
| `api.refreshCells()` / `refreshLayout()` | `api.view.refreshCells()` / `api.view.refreshLayout()` |
| `api.getDiagnostics()` | `api.diagnostics.get()` |

根级仍保留 `batch`、`whenReady`、`getOption`、`updateOptions`、`on`、`destroy`、`isDestroyed`。

```ts
api.batch((grid) => {
  grid.rows.transact({ update: changedRows });
  grid.view.refreshCells({ rowIds: changedIds });
});
```

### 2. 只使用 `rowKey`

简单字段和派生规则统一为：

```ts
rowKey: "id"
rowKey: (row) => `${row.tenantId}:${row.id}`
```

回调直接接收行数据，不再接收 `{ data }` 参数对象。

### 3. 持久化合并为一个配置

完整工作区：

```ts
persistence: { key: "tenant:user:orders" }
```

只保存列宽、顺序、显隐、固定和排序：

```ts
persistence: {
  key: "tenant:user:orders",
  sections: ["columns", "sort"],
  store: customStore,
  debounceMs: 160
}
```

旧的多组 state/column state key 与 store 不再存在。`initialState` 和手动 `api.state.apply()` 继续使用同一 GridState v2 契约。

### 4. 框架命名统一

- Vue/React 组件只有 `MachTable`。
- Vue/React 生命周期 Hook 都叫 `useMachTable()`。
- 远程 Query 返回 `bindings`，不再提供重复别名。
- Vue 只保留 `provideMachTableConfig()`，不再维护另一套 defaults 注入函数。
- React Provider 只接收 `config`。

### 5. 可选能力从子入口导入

```ts
import { useMachTableQuery } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";
```

React 使用相同的 `/workflows`、`/ui`、`/adapters`、`/worker` 结构。Vue 另有 `/async` 与 `/editors`。

### 6. renderer/editor 注册改为作用域配置

内置 renderer 保持不可变。业务组件通过应用配置顶层 `components` 或单表 `components` 注入，不再使用进程级可变注册函数：

```ts
defineMachTableConfig({
  components: { cellRenderers: { statusTag: StatusTagRenderer } }
});
```

这避免 SSR、多租户、微前端和测试之间互相污染。

### 7. Locale 与 State 名称

- `MachTableLocale` / `MachTableLocaleKey` 是规范类型名。
- `normalizeGridState()` 只归一化当前 v2 输入。
- v1 迁移代码已移除；旧业务快照应由宿主迁移或清空后再升级。

## 升级验证

```bash
pnpm typecheck
pnpm build
pnpm test
```

业务项目重点验证：

- 所有命令已进入正确领域。
- `rowKey` 回调签名正确且全局唯一。
- 持久化恢复的区段符合预期。
- Vue/React 可选能力从子入口导入。
- 编辑部分成功/冲突和远程请求取消仍按业务预期工作。
- 列宽拖动后刷新页面能恢复且不会跨用户串状态。

更早版本的历史变更保留在各包 Changelog；当前接入文档不再展示已删除 API，避免复制旧示例。
