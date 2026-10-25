# 服务端分组与聚合 Store

`@agile-team/mach-table/server-side` 是可选的层级数据 Store。分组、聚合、排序和过滤由服务端执行；浏览器按 **route 的活动页** 缓存和展示。它与默认本地 RowModel、普通远程分页及随机块列表独立，不把客户端缓存投影当成全树总量，也不宣称完整复现 AG SSRM。

Vue / React 直接从 `@agile-team/mach-table-vue/server-side` / `@agile-team/mach-table-react/server-side` 导入这些函数和类型，样式使用对应包的 `styles/server-side.css`，无需直接安装 Core。Store 在一个表格生命周期内创建一次，组件重渲染时复用。

## 扁平接入

```ts
import {
  createServerSideStore,
  bindServerSideGrid,
  createServerSideGroupColumn,
  serverSideDataColumn
} from '@agile-team/mach-table/server-side';
import '@agile-team/mach-table/styles/server-side.css';

const store = createServerSideStore<Order>({
  blockSize: 50,
  maxBlocks: 12,
  maxConcurrentRequests: 4,
  query: {
    rowGroupCols: [{ colId: 'region' }, { colId: 'department' }],
    valueCols: [{ colId: 'amount', aggFunc: 'sum' }]
  },
  getRows: request => orderApi.getGroupedRows(request),
  transact: request => orderApi.transactGroup(request)
});

const options = {
  rowData: [],
  columnDefs: [
    createServerSideGroupColumn(store, { headerName: '区域 / 部门' }),
    serverSideDataColumn<Order>('orderNo'),
    serverSideDataColumn<Order>('amount', { headerName: '金额', sortable: true })
  ],
  onGridReady: ({ api }) => bindServerSideGrid(api, store)
};
```

工厂创建一次 Store，表格就绪后绑定一次。绑定负责根页加载、投影同步、排序/过滤事件和选择同步；表格销毁时自动释放 Store。返回的解绑函数也可提前释放。不要同时把同一个表格连接到其他 `datasource`、分页工作流或本地分组；绑定会接管 `rowKey`、多选、手动排序/过滤及关闭客户端分页。

绑定时以表格已恢复的排序与过滤状态初始化请求，因此偏好中的慢恢复仍遵守 Core 的状态代次保护。需要默认筛选时，优先配置表格初始状态；不要给表格与 Store 同时提供互相矛盾的筛选。未绑定表格时，Store 自己的 `query` 是请求来源。

`data` 保留原始业务对象，投影另含 `key`、`route`、`depth`、`expanded`。自定义 renderer 通过 `params.data.data` 读取业务字段；`serverSideDataColumn()` 自动读取该字段，并在分组行优先显示 `aggValues[colId]`。投影是服务端只读视图，业务修改通过显式 CAS 事务提交，不能靠本地编辑改变服务端聚合结果。

如果宿主另外提供了可编辑列，绑定会保护正在编辑或存在未保存修改的表格：Store 可以继续获取新数据，但界面保留旧投影并显示“新数据等待显示”提示，层级操作暂时禁用。保存、回滚或取消编辑后才应用最新快照；旧投影的选择事件不会作用到新查询。不会为了刷新而隐式清空业务修改。

默认分组列提供展开/收起、层级选择、子分组上一页/下一页、加载范围与失败重试。根页控制位于该列的表头。没有合成的“加载更多”业务行；`snapshot.routes` 明确报告每个层级的 `startRow/endRow/rowCount`。

## 请求与响应

```ts
// 根层：route=[]；区域展开后：route=['华东']。
const request = {
  route: ['华东'], startRow: 0, endRow: 50,
  rowGroupCols: [{ colId: 'region' }, { colId: 'department' }],
  valueCols: [{ colId: 'amount', aggFunc: 'sum' }],
  sortModel: [], filterModel: {}, advancedFilterModel: null,
  quickFilterText: null, revision: null, signal
};

const result = {
  rows: [{
    id: 'production', groupKey: '生产部', childCount: 108,
    data: { department: '生产部' }, aggValues: { amount: 126800 }
  }],
  rowCount: 1,
  revision: 'department-store:42'
};
```

`rowCount` 是当前 route 的兄弟行总数，不是整棵树的扁平总数。分组深度尚未达到 `rowGroupCols.length` 时，服务端必须返回带 `groupKey` 的分组行；叶层返回普通行。`id` 在同一兄弟 Store 内稳定且唯一；同名 ID 可以出现在不同 route，投影 key 会进行 route 隔离。空白分组允许使用空字符串 key。

服务端必须验证请求字段、权限和聚合函数白名单。`aggFunc` 是传给服务端的名称，浏览器不解释或执行字符串表达式。每个响应携带该 route 的不透明版本号；版本变化会失效该 route 的其他旧块，避免拼接不同版本数据。

版本隔离以 route 为单位，不保证不同层级之间是全树原子快照。需要跨层强一致时，服务端应在一次查询生命周期内绑定自己的快照，并在宿主 transport 中携带该快照身份。

```ts
await store.load(['华东'], 100); // 按 blockSize 对齐活动页
await store.expand(['华东']);
store.collapse(['华东']);
await store.refresh(['华东']);
await store.setQuery({ quickFilterText: '紧急' });
const snapshot = store.getSnapshot();
```

每个 route 的最后一次翻页意图优先，较早的响应可以进入缓存，但不会把界面翻回旧页。刷新对 route 和后代递增代次并取消旧请求；查询变化取消整个旧作用域并重置展开与选择。刷新保留同查询下的展开意图和选择规则，重新加载当前可见路径。删除后活动页超出新总量时自动回到最后有效页。失败写入 route 的 `error`，可以显式 `refresh(route)` 重试。

## 版本事务与聚合刷新

```ts
const route = snapshot.routes.find(item => item.route.join('/') === '华东');
await store.transact({
  route: ['华东'],
  expectedRevision: route.revision,
  update: [{ id: 'production', groupKey: '生产部', data: updatedDepartment }]
});
```

必须先加载该 route 取得版本；本地版本不匹配时立即抛出 `ServerSideVersionConflictError`。宿主的 `transact` transport 同样必须在服务端原子校验 `expectedRevision`，成功后返回 `{ revision }`，不能把客户端检查当作服务端 CAS。事务成功后从根层刷新聚合，并恢复展开路径；不会在浏览器猜测插入位置或重算服务端聚合。服务器冲突原样返回，调用方应刷新和审阅后决定下一步，不自动覆盖或重试事务。

所有 transport 都收到 `AbortSignal`。查询切换和销毁会取消请求及事务等待；即使 transport 忽略取消，晚到结果也不能恢复旧投影。取消不能撤销服务器已经提交的事务。不要把加载失败自动重试用于写操作：只有 `getRows` 根据 `retryCount/retryDelay` 做有限指数退避，事务不自动重试。

## 层级选择规则

分组勾选默认表示选择整条 group route 下的后代，包含尚未加载的页。取消一个叶行会形成显式排除，父组显示部分选中；取消子组形成 route 排除。折叠或淘汰缓存不会丢失选择意图。`select(row, selected, 'self')` 只操作该行，不影响后代。

`snapshot.selection` 包含 `selectedKeys/selectedRoutes/excludedKeys/excludedRoutes`，宿主可把它与当前查询一起提交服务端。它不等同于浏览器已加载的业务行列表；默认客户端全选只能选当前投影，不能代表未知根分组。查询改变会清空选择，防止旧查询规则作用到新结果。

## 有界资源与明确边界

- 每 route 同时展示一页，`blockSize` 默认 100，最大 1000；默认缓存 12 块、最多并发 4 个读取请求。读取并发可配置到 16，默认重试 1 次，最多 5 次。
- 活动根页和展开 route 的活动页优先保留。缓存硬上限为 `max(maxBlocks, 活动保护页数 + 1)`，额外一页用于翻页进展；展开最多 128 条 route。折叠后按预算淘汰。
- route 元数据最多 256 项，空闲且未展开的 route 会回收；总共最多等待 256 次读取，超限明确失败。事务并发上限独立采用 `maxConcurrentRequests`。
- 分组最多 16 层，聚合列最多 128 列，选择最多 10000 条显式规则。销毁会释放缓存、元数据、订阅、选择和传输等待。
- `snapshot.rows` 只包含可见活动页的扁平投影。全树任意 offset 映射、跨 route 任意位置插入、Pivot 和全量导出需要额外服务端协议，不由缓存投影冒充实现。

仓库单测和浏览器故障场景覆盖协议、展开分页、聚合刷新、CAS、层级选择、乱序请求、编辑等待及销毁；实际执行结果以当前报告为准。示例使用明确标注的本地模拟 transport，不能代替真实后端权限、原子事务与多业务 UAT。当前尚无这套 Store 已在多个生产业务完成验收的证据。
