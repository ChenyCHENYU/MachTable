# 列宽拖动、列状态与记忆

Vue / React 默认 `list` 场景已开启列宽交互；`detail` 默认关闭。裸 Core 按需开启：

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

## 随容器宽度填满

```ts
const options = {
  columnLayout: "fit",
  columnDefs: [
    { field: "name", width: 140, minWidth: 120 },
    { field: "description", width: 280, minWidth: 180 },
    { field: "status", width: 100, minWidth: 90, maxWidth: 160 }
  ]
};
```

`fit` 以列宽为比例，按容器的实际可用宽度分配空间；左右固定列和 `suppressSizeToFit` 列保留自身宽度。窄屏不足以容纳最小宽度时保留横向滚动，不强行挤压内容。

在 `fit` 模式调用 `autoSize()` / `autoSizeAll()` 时，测量结果作为内容基准参与后续分配，容器变宽后仍会自动填满。`contentWidth` 随列状态保存，恢复时保留测量比例；选择、序号和操作等 `suppressSizeToFit` 列保持配置宽度。窗口缩放只重新分配已测量的宽度，不反复扫描数据。

手动拖拽、键盘调宽或 `setWidth()` 只改变目标列，其他列保留当前宽度，松手后不会反跳。其他列仍保留自己的自动 / flex 模式，真正的容器宽度、列结构或内容测量变化时才重新布局；单纯出现滚动条不会当成容器缩放。需要主动重新分配时调用 `fit()` / `autoSizeAll()`，或重置列状态。

默认普通布局按内容确定首选宽度。需要余量交给描述列时，仅为该列设置 `flex: 1`；状态、日期和数值列无需统一铺满。`fit` 适用于确实要整表按比例铺满的场景，无需全局开启。

## 内置列工作台

```ts
api.columns.openWorkbench(buttonElement);
const items = api.columns.getWorkbenchItems();
api.columns.closeWorkbench();
```

工作台支持搜索、显隐、左右固定、同组排序、自动列宽和重置。若要使用设计系统 Drawer，读取 `getWorkbenchItems()` 构建自定义 UI，再调用同领域的列命令。

## 健壮性约定

- Escape、取消拖动或拖回起点会恢复开始时宽度及原自动模式，不保存半成品。
- 一次完成拖动只提交一次状态保存。
- 未触碰的 flex/自动列继续响应容器变化。
- 宽度按 `minWidth/maxWidth` 约束，未知列或非法值返回 `false`。
- `columnDefs` 更新后按稳定 `colId` 重新应用已保存列状态。
- key 必须包含用户/租户与业务 schema 版本；改变关键列结构时升级后缀。

相关：[完整状态持久化](/recipes/grid-state) · [列工作台](/recipes/column-workbench) · [GridApi](/api/grid-api)
