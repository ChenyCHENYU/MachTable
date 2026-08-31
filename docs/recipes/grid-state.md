# GridState 与自动持久化

MachTable 用一份版本化 `GridState` 表达可恢复工作区：列、排序、普通/高级过滤、快速搜索、分页、选择和展开。

## 自动保存完整工作区

```ts
const options: GridOptions<Order> = {
  columnDefs,
  rowData,
  rowKey: "id",
  persistence: {
    key: `${appId}:${tenantId}:${userId}:orders:v2`
  }
};
```

默认 store 使用 localStorage，默认防抖为 160ms；销毁前会刷新待保存状态。跨账号、租户和工作空间必须使用不同 key。

## 只保存指定区段

```ts
persistence: {
  key: "tenant:user:orders:v2",
  sections: ["columns", "sort", "filter"],
  debounceMs: 200
}
```

合法区段：`columns`、`sort`、`filter`、`pagination`、`selection`、`expansion`。只要列偏好时使用 `sections: ["columns"]`。

## 自定义 store

```ts
const store: GridStateStore = {
  load: (key) => preferencesApi.get<GridState>(key),
  save: (key, state) => preferencesApi.put(key, state),
  clear: (key) => preferencesApi.remove(key)
};

persistence: { key, store, debounceMs: 250 }
```

store 可以同步或异步。加载失败或非法快照会报告稳定错误并回退当前默认状态。

## 手动快照

```ts
const snapshot = api.state.get();
await preferencesApi.put("workspace", snapshot);

const cached = await preferencesApi.get<GridState>("workspace");
if (cached) {
  api.state.apply(cached, { emitEvents: false });
}
```

只恢复部分：

```ts
api.state.apply(snapshot, {
  sections: ["columns", "sort", "filter"],
  emitEvents: true
});
```

`initialState` 用于首屏一次性恢复；`persistence` 用于自动加载/保存；`api.state.apply()` 用于命名视图、后端快照或跨页面传递。应明确唯一最终来源，避免多个异步恢复相互覆盖。

## Schema 与业务版本

当前 `GridState.version` 为 `2`。`normalizeGridState(input)` 只接收并净化当前 v2 schema；无效列状态、过滤、超长 ID/搜索文本和超限集合会被有界处理。

业务仍应维护自己的 key 版本：

```text
my-app:tenant:user:orders:v3
```

删除/重命名关键列、改变筛选语义或 `rowKey` 规则时，升级后缀或由宿主显式迁移旧快照。不要把不兼容输入直接回放。

## 远程与选择

选择、展开状态依赖稳定 `rowKey`。远程块尚未加载时，已恢复 ID 可以保留，数据到达后再同步。查询级“全选匹配结果”属于 `useMachTableQuery` 的远程选择协议，不写进普通 GridState。

## 命名视图的区别

命名视图通常只保存列、排序、过滤和页大小，不包含当前选择、页码和展开，适合作为长期偏好；完整 persistence 更像页面会话恢复。详见[命名视图](/recipes/saved-views)。
