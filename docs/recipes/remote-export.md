# 服务端全量导出

`api.io.exportCsv()` 和可选 XLSX 扩展序列化浏览器里已有的行。客户端完整数据集可跨本地分页导出；服务端分页、顺序加载和随机块数据源只能导出当前已加载的数据。全量远程导出应交给业务服务端，避免缓存淘汰或尚未访问的页面造成静默漏行。

## 固定导出范围

`createRemoteExportRequest()` 从表格提取可见列、排序、普通/高级/快速过滤的独立快照，不遍历行，也不发请求。业务查询条件仍由页面传给后端。

```ts
import { createRemoteExportRequest } from "@agile-team/mach-table-vue";

const request = createRemoteExportRequest(api, { scope: "filtered" });
await orderApi.startExport({
  ...request,
  query: { ...searchForm }
});
```

`filtered` 表示服务端按当前查询和过滤条件导出全部匹配行；`selected` 表示只导出所选行。普通行选择默认读取 `api.state.get().selectedRowIds`。Vue/React 的远程查询工作流管理跨页选择时，应显式传入其选择规则：

```ts
const request = createRemoteExportRequest(api, {
  scope: "selected",
  selection: table.selectionState.value // Vue；React 使用 table.selectionState
});
```

`selection` 支持 `{ mode: "explicit", selectedKeys }` 和 `{ mode: "allMatching", excludedKeys }`，与 `useMachTableQuery()` 的跨页选择模型一致。`allMatching` 不要求把所有主键下载到浏览器。`createRemoteExportRequest()` 会复制选择数组、过滤模型和排序模型，之后的表格操作不会改变已提交请求。

## 服务端约定

- 根据当前用户权限重新校验业务查询、字段白名单和选择规则；前端快照不是授权凭据。
- 明确导出的是请求创建时的查询结果还是任务执行时的最新结果；需要一致性时由服务端保存查询版本或快照。
- 大表使用异步任务，返回任务 ID，由业务页面显示进度、取消和失败原因；文件生成后通过受权接口下载。
- 记录导出范围、筛选摘要和数据量，避免把“已加载行”误称为“全部结果”。

原有 `api.io.exportCsv()`、工具栏导出和 XLSX 扩展保持原行为。需要本地小表导出时继续使用它们；远程全量导出由业务显式接入服务端任务。
