# 批量保存、失败与版本冲突

0.18 的保存协议以“稳定快照”为边界：提交开始后用户可以继续编辑；旧请求成功时只确认快照中的同值修改，新产生的修改仍保持脏状态，不会被误清空。

## Core API

```ts
const result = await api.saveChangesDetailed(async (changes) => {
  const response = await orderApi.batchUpdate(changes);
  return {
    savedRowIds: response.savedIds,
    failures: response.validationErrors.map((item) => ({
      rowId: item.id,
      code: "VALIDATION_FAILED",
      message: item.message,
      colIds: item.fields
    })),
    conflicts: response.conflicts.map((item) => ({
      rowId: item.id,
      code: "VERSION_CONFLICT",
      message: "数据已被其他用户修改",
      serverVersion: item.version,
      serverData: item.current
    }))
  };
});

console.log(result.submitted, result.saved, result.failures, result.conflicts);
```

原有 `saveChanges()` 保持兼容，只返回本次成功确认的 `GridChange[]`。新业务应使用 `saveChangesDetailed()` 展示逐行失败和冲突。

## Vue / React 工作流

`useMachTableEditing()` 在两个框架中提供同名能力：

- `saveDetailed(handler, rowIds?)`：返回完整结果；
- `lastSaveResult`、`saveIssues`、`failedRowIds`：渲染错误区和定位入口；
- `reveal(rowId, colId?, true)`：滚动并重新打开失败字段；
- `resolveConflict(rowId, "acceptServer" | "keepLocal")`：接受服务端值，或保留本地值等待再次提交；
- `clearSaveIssues()`：用户确认后清理展示状态。

```ts
const editing = useMachTableEditing(grid, {
  guardBeforeUnload: true,
  onSaveResult: (result) => auditSaveResult(result)
});

const result = await editing.saveDetailed(orderApi.saveChanges);
if (result.conflicts.length) editing.reveal(result.conflicts[0].rowId);
```

`acceptServer` 只有在冲突包含 `serverData` 且其稳定行 ID 与冲突行一致时才执行：先回滚本地脏值，再以事务更新服务端行并确认干净状态。ID 不匹配会安全拒绝，不能误覆盖其他行。`keepLocal` 不修改数据，只关闭该冲突提示；下一次保存仍会提交本地修改。

## 服务端协议建议

1. 每行携带版本号或 ETag，服务端使用乐观锁。
2. 一次请求可以部分成功，但每个失败行必须提供稳定 `rowId` 和用户可理解的 `message`。
3. 同一行只返回一种结果；若错误响应同时包含 failure 与 conflict，客户端以 conflict 为准。
4. 服务端未返回的未知行 ID 会被客户端忽略，不能借此确认未提交行。
5. 网络错误直接 reject；业务校验与版本冲突应以结构化结果返回。
6. 冲突合并策略属于业务，不在通用表格内自动猜测。
