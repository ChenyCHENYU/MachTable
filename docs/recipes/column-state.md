# 列状态记忆

用户调过的列宽、顺序、显隐、固定、排序可以自动记住，下次打开页面原样恢复。列宽拖动是显式能力，默认不开启；只有配置后才渲染拖动把手。

## 推荐：拖动并记忆完整工作区

```ts
createGrid(host, {
  columnDefs,
  rowData,
  enableColumnResize: true,
  stateKey: "machine-grid" // 列宽以及排序、过滤、分页等完整状态
});
```

拖动中只更新布局和发送 `finished: false` 事件，松手后才进行一次状态提交；`pointercancel`、失去捕获或运行时关闭功能会回滚本次未完成拖动。触摸拖动、双击自适应以及表头 `Alt+←/→` 共用同一套宽度边界和提交逻辑。

页面只需要列偏好、不需要保存筛选和选择时，使用下面的 `columnStateKey`。

## 仅列状态的 localStorage 模式

```ts
createGrid(host, {
  columnDefs,
  rowData,
  enableColumnResize: true,
  columnStateKey: "machine-grid"   // 每个表格场景一个稳定 key
});
```

写入时机：调宽/换位/显隐/固定/排序结束时自动保存。读取时机：创建时与 `setColumnDefs` 后自动应用（按 colId 匹配，新增列不受影响）。没有 `stateKey` 或 `columnStateKey` 时仍可拖动，但不会写入任何存储。

默认存储已经使用 `{ version, savedAt, columns }` 信封，并能读取旧版数组格式。多租户项目建议显式隔离并提供迁移：

```ts
import {
  createColumnStateKey,
  createLocalColumnStateStore
} from "@agile-team/mach-table-vue";

const columnStateStore = createLocalColumnStateStore({
  namespace: "erp:table-layout",
  version: 3,
  migrate(columns, fromVersion) {
    if (fromVersion < 3) {
      return columns.map((column) =>
        column.colId === "customerName" ? { ...column, colId: "customer.name" } : column
      );
    }
    return columns;
  },
  onError: (error, operation, key) => telemetry.captureException(error, { operation, key })
});

const columnStateKey = createColumnStateKey({
  app: "erp",
  tenant: session.tenantId,
  user: session.userId,
  route: route.name?.toString(),
  table: "order-list",
  schema: 3
});
```

将 `columnStateStore` 放入全局配置的 `defaults`，页面只需要提供 `columnStateKey`。迁移失败或载荷损坏会安全回退到列默认值；载荷还会过滤重复 ID、非法宽度和非法固定/排序值。

## 后端存储（按用户记忆）

```ts
import type { ColumnStateStore } from "@agile-team/mach-table";

const columnStateStore: ColumnStateStore = {
  // load 支持同步或返回 Promise
  async load(key) {
    const res = await fetch(`/api/user/col-state/${key}`);
    return res.ok ? await res.json() : null;
  },
  save(key, state) {
    void fetch(`/api/user/col-state/${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });
  }
};

createGrid(host, { columnDefs, rowData, columnStateKey: "machine-grid", columnStateStore });
```

异步 `load` 会在返回后应用状态并重排列结构。

## 手动读写（导出/导入用户配置）

```ts
const state = api.getColumnState();
/* state: [{ colId, hide, width, flex, widthMode, pinned, sort, sortIndex }, ...] —— 可 JSON 序列化 */

api.setColumnState(savedState);    // 应用（并持久化）
api.resetColumnState();            // 重置为 columnDefs 初始状态（并持久化）
```

## 列设置面板

`columnMenu: true` 开启两种入口：

1. 每列表头 ⋯ 按钮：升/降序、固定左/右、自适应列宽、隐藏此列、全部列显隐清单、重置全部、全部自适应
2. `api.openColumnWorkbench()`：可搜索的独立列工作台（工具栏“列设置”按钮常用），默认锚定表格右上角；`openColumnPanel()` 只作为 0.x 兼容别名保留

面板文案走 i18n。

## 行为细节

| 场景 | 行为 |
| --- | --- |
| `setColumnDefs` 更新列 | 状态按 colId 保留（新列用默认；消失列的状态滞留无害） |
| 状态中的列顺序 | 应用时在同窗格/同分组内重排 |
| 与列拖拽 | 用户拖拽换位即写入状态 |
| 自动/flex 列 | `widthMode: "auto"` 保留响应式布局；拖动后变为 `"manual"` 像素宽度，避免恢复误判和列宽跳动 |
| 拖动取消 | 恢复拖动前的像素宽度或 flex，不触发持久化 |
| localStorage 键 | `mach-table:col-state:{key}`（版本化信封；工具函数 `saveColumnState/loadColumnState/clearColumnState` 可直接操作） |
