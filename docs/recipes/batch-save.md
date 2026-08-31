# 批量保存、失败与版本冲突

`api.editing.save()` 以稳定变更快照为边界：提交开始后用户可以继续编辑；旧请求成功时只确认快照中的同值修改，新产生的修改仍保持脏状态。

```ts
const result = await api.editing.save(async (changes) => {
  const response = await orderApi.saveBatch(changes);
  return {
    savedRowIds: response.savedIds,
    failures: response.failures,
    conflicts: response.conflicts
  };
});

console.table(result.saved);
console.table(result.failures);
console.table(result.conflicts);
```

返回结构：

```ts
interface GridBatchSaveResult<T> {
  submitted: GridChange<T>[];
  saved: GridChange<T>[];
  failures: SaveChangeIssue[];
  conflicts: SaveChangeConflict<T>[];
}
```

handler 不返回结果时表示全部提交成功；返回 `savedRowIds` 可表达部分成功。失败/冲突行仍保持脏状态。

## 校验失败

```ts
return {
  savedRowIds: ["order-1"],
  failures: [{
    rowId: "order-2",
    code: "AMOUNT_REQUIRED",
    message: "金额不能为空",
    colIds: ["amount"],
    retryable: false
  }]
};
```

## 乐观锁冲突

```ts
return {
  conflicts: [{
    rowId: "order-3",
    code: "VERSION_CONFLICT",
    message: "订单已被其他用户修改",
    serverData: latestOrder,
    serverVersion: latestOrder.version,
    retryable: true
  }]
};
```

业务必须明确选择：

```ts
resolveSaveConflict(api, conflict, "acceptServer");
resolveSaveConflict(api, conflict, "keepLocal");
```

Vue/React 的 `useMachTableEditing()` 提供响应式封装：

```ts
const editing = useMachTableEditing(table, { guardBeforeUnload: true });
const result = await editing.saveDetailed(orderApi.saveChanges);

if (result.conflicts.length) {
  editing.reveal(result.conflicts[0].rowId);
  editing.resolveConflict(result.conflicts[0].rowId, "keepLocal");
}
```

`saveDetailed()` 与 Core `editing.save()` 返回相同明细；便利 `save()` 仅返回成功的 `GridChange[]`。同一实例不允许并发保存，重复调用会立即报错，避免响应顺序不确定。
