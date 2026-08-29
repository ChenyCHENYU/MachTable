# 树表懒加载

0.13 支持按节点异步加载子级，适合组织树、物料分类、区域资产和大目录。加载器只有在用户第一次展开可展开节点时才执行；同节点并发请求自动合并。

```ts
const options: GridOptions<Department> = {
  treeData: true,
  childrenKey: "children",
  rowData: roots,
  getRowId: ({ data }) => data.id,
  isTreeRowExpandable: ({ data }) => data.hasChildren,
  loadTreeChildren: async ({ data, signal }) => {
    const response = await departmentApi.children(data.id, { signal });
    return response.records;
  }
};
```

`getRowId` 在懒加载场景是强烈建议项。父子节点必须具有全表唯一、稳定的 ID；重复 ID 会进入 `gridError`，不会静默覆盖已有节点。

## 状态与重试

展开时节点会暴露只读状态：

```ts
node.treeLoading;
node.treeChildrenLoaded;
node.treeLoadError;

await api.loadTreeChildren(rowId);       // 已加载时直接命中缓存
await api.retryTreeChildren(rowId);      // 强制重新请求并原子替换子树
api.isTreeRowLoading(rowId);
```

失败后展开图标进入错误态，再次点击会重试。也可以在页面错误提示中调用 `retryTreeChildren()`。成功和失败分别发出：

```ts
onTreeChildrenLoaded: ({ rowId, children }) => audit.success(rowId, children.length),
onTreeChildrenLoadFailed: ({ rowId, error }) => telemetry.capture(error, { rowId })
```

## 生命周期保证

- `setRowData()`、切换数据集和 `destroy()` 会中止仍在进行的子级请求。
- 同一节点的并发加载共享 Promise，避免双击造成重复请求。
- 强制重试在新数据成功后才替换旧子树；失败不会写入半棵树。
- 子树替换后重新建立索引和选择状态，展开、筛选、虚拟滚动继续使用稳定 ID。
- 服务端仍必须校验数据权限；前端的 `isTreeRowExpandable` 只负责交互，不是安全边界。
