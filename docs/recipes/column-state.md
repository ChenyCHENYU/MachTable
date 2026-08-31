# 列宽拖动、列状态与记忆

列宽交互默认关闭。需要时显式开启：

```ts
const options: GridOptions<Machine> = {
  columnDefs,
  rowData,
  rowKey: "id",
  enableColumnResize: true
};
```

支持鼠标/触控拖动、双击按内容自适应和表头 `Alt + ←/→` 键盘调整。列级 `resizable: false` 可排除选择列、操作列等固定宽度列。

## 只记忆列偏好

```ts
const options = {
  enableColumnResize: true,
  persistence: {
    key: `${tenantId}:${userId}:machines:v2`,
    sections: ["columns"]
  }
};
```

`columns` 区段只包含宽度、顺序、显隐和固定；需要同时记忆排序时使用 `sections: ["columns", "sort"]`。读取时按 `colId` 匹配；新增列使用自身默认值，已删除列会被忽略。未配置 `persistence` 时仍可拖动，但不会写入存储。

## 记忆完整工作区

省略 `sections`：

```ts
persistence: { key: `${tenantId}:${userId}:machines:v2` }
```

这会同时保存列、排序、过滤、分页、选择和展开。不要再为列状态配置第二套 store。

## 自定义后端/IndexedDB store

```ts
const store: GridStateStore = {
  async load(key) {
    return preferencesApi.get<GridState>(key);
  },
  async save(key, state) {
    await preferencesApi.put(key, state);
  },
  async clear(key) {
    await preferencesApi.remove(key);
  }
};

const options = {
  persistence: {
    key: "tenant:user:orders:v3",
    sections: ["columns"],
    store,
    debounceMs: 200
  }
};
```

store 支持同步或异步。载荷损坏、重复列 ID 和非法宽度会被安全归一化，不会阻止表格创建。

## 程序化控制

```ts
api.columns.setWidth("amount", 180);
api.columns.autoSize("customerName");
api.columns.autoSizeAll();
api.columns.fit();

const state = api.columns.getState();
api.columns.setState(state);
api.columns.resetState();
```

程序化宽度不受 `enableColumnResize` 限制。完成的变更统一触发列事件，并由 persistence 协调器保存。

## 内置列工作台

```ts
api.columns.openWorkbench(buttonElement);
const items = api.columns.getWorkbenchItems();
api.columns.closeWorkbench();
```

工作台支持搜索、显隐、左右固定、同组排序、自动列宽和重置。若要使用设计系统 Drawer，读取 `getWorkbenchItems()` 构建自定义 UI，再调用同领域的列命令。

## 健壮性约定

- 拖动取消会恢复开始时宽度，不保存半成品。
- 一次完成拖动只提交一次状态保存。
- 未触碰的 flex/自动列继续响应容器变化。
- 宽度按 `minWidth/maxWidth` 约束，未知列或非法值返回 `false`。
- `columnDefs` 更新后按稳定 `colId` 重新应用已保存列状态。
- key 必须包含用户/租户与业务 schema 版本；改变关键列结构时升级后缀。

相关：[完整状态持久化](/recipes/grid-state) · [列工作台](/recipes/column-workbench) · [GridApi](/api/grid-api)
