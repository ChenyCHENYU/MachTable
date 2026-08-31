# 升级指南

MachTable 尚处于 0.x，minor 版本可能包含有意的契约整理。升级前阅读本页与各包 Changelog，并在业务预发布环境回归。

```bash
pnpm up @agile-team/mach-table-vue@^0.28.0
# 或
pnpm up @agile-team/mach-table-react@^0.28.0
```

## 0.25 → 0.28

0.28 是稳定性治理版本，没有新增、删除或改名公共 API，也不要求修改现有 Vue/React 页面：

- 31 项历史圈复杂度豁免已全部清零，所有生产函数统一受 `15` 的门禁约束。
- 配置解析、布局、渲染、选择、筛选、编辑动作和交互事件按职责拆分，公共 API 快照保持不变。
- 集合筛选在搜索后会保留不可见选项的已选状态，并正确区分同文本的数字/字符串/空值；列菜单按下不再进入列拖拽路径。
- 直接把框架适配包升级到 `^0.28.0` 即可；无需额外安装 Core，也无需迁移配置文件。

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
