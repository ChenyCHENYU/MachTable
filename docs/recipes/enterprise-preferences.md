# 企业偏好与字段迁移

`@agile-team/mach-table/preferences` 是可选入口。它复用表格已有的 `persistence.store`，负责身份归属、字段迁移、每表有序写入和版本冲突，不依赖登录 Store、HTTP 客户端或具体后端。

Vue 从 `@agile-team/mach-table-vue/preferences`、React 从 `@agile-team/mach-table-react/preferences` 导入相同函数和类型即可，无需另外安装 Core。该入口没有额外样式。

## 一次创建，接入现有持久化配置

```ts
import { createGridPreferenceStore } from '@agile-team/mach-table/preferences';

// 在一个账号/页面生命周期内创建一次，组件渲染时复用。
const preferences = createGridPreferenceStore({
  identity: () => session.currentIdentity,
  columns: ['orderNo', 'amount', 'status'],
  renameColumns: { total: 'amount' },
  columnTypes: { amount: 'number', status: 'set' },
  load: ({ identity, key, signal }) => preferenceApi.load({ identity, key, signal }),
  save: ({ identity, key, state, expectedRevision, signal }) =>
    preferenceApi.save({ identity, key, state, expectedRevision, signal }),
  onMigration: ({ report }) => showPreferenceMigrationReport(report)
});

const tableOptions = {
  persistence: {
    key: 'orders',
    store: preferences,
    sections: ['columns', 'sort', 'filter']
  }
};

// 页面/账号生命周期结束时释放；新账号创建新的 store 和表格实例。
// preferences.dispose();
```

`identity()` 返回 `{ tenantId, userId, pageId, schemaId }` 或 `null`。四个字段与表格 `key` 必须全部参与服务端存储主键及权限检查；不能只用页面或表名作为存储主键。`schemaId` 用于隔离不兼容的字段体系。跨 schema 恢复必须由宿主明确选择旧记录并调用迁移工具，适配器不会自动读取其他 schema 的数据。

一个 store 绑定首次有效身份。后续任一身份字段改变、退出登录或 `dispose()`，会永久作废旧实例并取消其已提交及排队的操作。新账号须创建新 store 并重建表格；旧表格销毁时的延迟保存仍使用旧 store，会被拒绝，不能串写到新账号。不需要精确安排“先退出登录还是先卸载组件”的时序。一个尚未获得有效身份的 store 加载返回 `null`，保存会以 `AbortError` 拒绝。

## 传输与并发契约

`load()` 返回 `{ state: unknown, revision: string }` 或 `null`；`save()` 必须返回成功提交后的 `{ revision: string }`。修订号是不透明的非空字符串，不能用浏览器自增值假冒服务器版本。

适配器在每个身份和表格 key 内串行执行加载及保存，不同 key 可以并行。首次保存没有已知修订号时，先加载版本，再保存；后续保存携带上次成功修订号。后端必须原子检查 `expectedRevision`：`null` 表示仅允许创建，字符串表示仅允许覆盖匹配版本的记录。客户端队列不能代替服务端 CAS，也不能解决其他标签页或其他浏览器的并发写入。

```ts
import { GridPreferenceConflictError } from '@agile-team/mach-table/preferences';

// 在宿主 transport 内把实际服务端冲突转成可识别错误。
if (response.conflict) {
  throw new GridPreferenceConflictError(expectedRevision, response.actualRevision);
}
```

冲突保留原错误，不自动覆盖或重试。宿主应提示用户，重新加载并审阅差异后再保存；不能在捕获冲突后直接盲目重试。一个失败不会破坏同 key 队列，但后续请求仍使用最后确认版本，直到显式加载取得新的修订号。

传输会收到 `AbortSignal`，应传给实际网络请求。即使传输忽略取消，适配器也会立即结束等待，屏蔽晚到结果；这不能撤销服务端已经完成的写入。身份在操作开始、实际调用传输前及结果完成时都会复核。Core 原有的本地状态变更代次继续防止慢加载覆盖用户刚完成的列宽、排序或过滤操作。

每个实例最多保留 64 个 key 的队列/版本；空闲 key 按最近使用顺序释放，64 个 key 全部繁忙时新 key 请求明确失败。每 key 最多排队 64 项，不会无限积累保存任务。释放实例会拒绝排队保存；内部已处理队列拒绝，调用方仍可通过返回 Promise 获得失败。

## 显式迁移与解释报告

```ts
import { migrateGridState } from '@agile-team/mach-table/preferences';

const { state, report } = migrateGridState(savedJson, {
  columns: ['orderNo', 'amount', 'status'],
  renameColumns: { total: 'amount' },
  columnTypes: { amount: 'number', status: 'set' }
});
if (state) api.state.apply(state);
```

同一映射同时作用于列布局、排序、普通过滤和嵌套高级过滤。已删除字段、重命名、重命名碰撞、非法过滤条件和超限内容都会产生有路径的报告；首个映射后的同 ID 条目保留，后续重复条目丢弃。无效条件被移除可能改变过滤范围，宿主可先展示报告供用户确认再应用。`onMigration` 是观察者，其异常不会阻断持久化。

`columns` 保持为列 ID 清单。可选 `columnTypes` 只需填写需要约束的目标列，值为 `text` / `number` / `date` / `set`，`false` 表示该列不允许过滤。工具先重命名，再按目标 ID 比较普通和高级过滤的类型；不兼容条件会移除并报告 `TYPE_CHANGED`（`from` 是旧类型，`to` 是目标类型或 `disabled`），不会猜测转换。省略的列保留原有类型语义，原先只传 `columns` 的用法继续兼容。移除条件可能扩大查询范围，应用迁移结果前应审阅报告。

适配器管理一份 GridState 偏好，不提供公共视图权限、默认视图审批或共享视图目录；命名视图仍使用独立的 [GridViewStore](/recipes/saved-views)。

可选工具只支持仓库中真实发布过的迁移链：旧 GridState v1（0.14/0.15 的完整基础字段）补充 `advancedFilterModel: null` 后进入 v2 规范化；当前 v2 按字段 schema 迁移。未知未来版本和不完整 v1 拒绝恢复。默认 Core 仍只接受 v2，不增加隐式兼容分支。

迁移不会执行表达式或读取业务数据。列布局和普通过滤最多检查 2000 列，高级过滤最多 512 个节点和 16 层；单字段最多 20 条条件或 2000 个集合值。所有过滤共用 10000 项和 64000 字符预算，单个字符串最多 1024 字符，超出部分报告并移除。报告最多 256 项；最后一项可标明报告被截断。行 ID 和快速搜索沿用 Core 的规范化上限。
