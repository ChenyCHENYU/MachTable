# 命名视图与用户工作区

命名视图用于保存“我的待办”“财务复核”等可复用展示偏好。它只包含列状态、排序、普通/高级过滤、快速搜索和页大小；不会保存当前页、行选择、树展开或主从详情展开，避免把瞬时业务状态误带到下次会话。

## 本地视图

```ts
import { createGridViewManager } from "@agile-team/mach-table-vue";

const views = createGridViewManager(api, {
  // 必须隔离租户、用户和业务页面。
  scope: `${tenantId}:${userId}:orders`
});

const saved = await views.save("我的待办");
const list = await views.list();
await views.apply(saved.id, { emitEvents: true });
await views.remove(saved.id);
```

默认 store 使用安全的 `localStorage` 信封，限制单 scope 50 个视图和 512 KiB。损坏的读取结果会回退为空列表；显式保存/删除遇到无存储环境、无痕限制或 quota 错误时会调用 `onError` 并 reject，页面可以准确提示“未保存”，不会产生假成功。

## 企业后端存储

```ts
import type { GridViewStore } from "@agile-team/mach-table";

const store: GridViewStore = {
  list: (scope) => preferenceApi.listGridViews(scope),
  save: (scope, view) => preferenceApi.putGridView(scope, view.id, view),
  remove: (scope, id) => preferenceApi.deleteGridView(scope, id)
};

const views = createGridViewManager(api, {
  scope: `${tenantId}:${userId}:orders`,
  store
});
```

后端应把 `scope` 视为路由提示而非权限凭据：租户和用户身份必须取自服务端会话；保存前校验 `schemaVersion`、大小和字段白名单。

## 与完整 GridState 的区别

| 能力 | 命名视图 | `persistence` / GridState |
| --- | --- | --- |
| 列、排序、过滤、页大小 | 保存 | 保存 |
| 当前页 | 重置为 1 | 保存 |
| 选择、树/分组展开 | 不保存 | 保存 |
| 用途 | 用户偏好、共享视图 | 页面会话恢复 |

若业务需要共享视图，保存服务端返回的视图 ID，不要把完整视图 JSON放进 URL。恢复失败时保留当前表格状态，并向用户提示视图已失效或无权限。
