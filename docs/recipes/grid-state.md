# 全量状态与工作区恢复

`GridState` 是带版本号的可序列化工作区快照，覆盖列状态、排序、普通/高级过滤、快速搜索、分页、选择、树/分组展开。它适合页签恢复、路由返回和页面会话恢复。只保存用户展示偏好时使用[命名视图](/recipes/saved-views)，避免携带选择与展开等瞬时业务状态。

## 零胶水自动持久化

大多数页面只需一个稳定 key：

```ts
const options: GridOptions<Order> = {
  rowKey: "id",
  stateKey: "orders-workspace"
};
```

MachTable 会在初始化前读取版本化状态，在列、排序、过滤、分页、选择和展开状态变化后防抖保存，并在销毁前刷新待保存内容。无效 JSON、版本不兼容、超限内容和存储异常会安全忽略，不会让表格白屏。

跨账号、租户或工作空间时应把维度写入 `stateKey`。需要后端/IndexedDB 时注入 `stateStore: { load, save, clear? }`；`stateSaveDebounceMs` 控制防抖，默认值适合普通交互。`columnStateKey` 仅保存列偏好，`stateKey` 保存完整工作区，通常二选一。

## 保存与恢复

```ts
const snapshot = api.getState();
localStorage.setItem("orders-workspace-v2", JSON.stringify(snapshot));

const cached = localStorage.getItem("orders-workspace-v2");
if (cached) api.applyState(JSON.parse(cached), { emitEvents: false });
```

首屏优先使用 `initialState`，避免默认视图闪现：

```ts
const options: GridOptions<Order> = {
  columnDefs,
  rowData,
  initialState: cachedState
};
```

## 部分恢复

```ts
api.applyState(snapshot, {
  sections: ["columns", "sort", "filter"],
  emitEvents: false
});
```

`columnStateKey` 只自动持久化列宽、顺序、显隐、固定和排序；配置 `stateKey` 后，完整 `GridState` 会在用户状态完成变化时自动防抖保存。手动 `getState/applyState` 仍适合命名视图、服务端快照和跨页面传递。两者同时使用时会形成两个最终来源，通常工作区恢复页面只选 `stateKey`。

## 版本迁移

0.18 的 `GridState.version` 为 `2`，新增 `advancedFilterModel`。`applyState()`、`initialState` 和内置 store 会自动把 v1 迁移到 v2；无效列状态、排序、过滤、超长 ID/搜索文本和超限集合会被有界归一化后再进入实例。

库状态包含 `version`，业务存储仍应维护自己的 schema 版本。删除/重命名关键列、改变筛选模型或行 ID 规则时，迁移或丢弃旧快照；不可信输入可先显式调用 `migrateGridState(input)`，返回 `null` 时不要回放。

```ts
interface StoredWorkspace {
  schema: 3;
  grid: GridState;
}
```

选择与展开状态依赖稳定 `rowKey` 或 `getRowId`。无限模式恢复选择时，尚未加载的行 ID 会保留，数据块到达后自动同步。
