# 全量状态与工作区恢复

`GridState` 是带版本号的可序列化视图快照，覆盖列状态、排序、列过滤、快速搜索、分页、选择、树/分组展开。它适合页签恢复、路由返回、保存视图和用户工作区。

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

`columnStateKey` 只自动持久化列宽、顺序、显隐、固定和排序；`GridState` 由业务决定保存时机，范围更完整。两者同时使用时，应明确谁是最终来源，通常工作区恢复页面只选 `GridState`。

## 版本迁移

库状态包含 `version`，业务存储仍应维护自己的 schema 版本。删除/重命名关键列、改变筛选模型或行 ID 规则时，迁移或丢弃旧快照；不要把未知 JSON 无校验地长期回放。

```ts
interface StoredWorkspace {
  schema: 2;
  grid: GridState;
}
```

选择与展开状态依赖稳定 `getRowId`。无限模式恢复选择时，尚未加载的行 ID 会保留，数据块到达后自动同步。
