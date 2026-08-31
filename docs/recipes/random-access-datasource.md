# 随机访问远程数据源

`datasourceMode: "block"` 面向十万到百万级、允许滚动条任意跳转的远程数据。它与默认的 `"sequential"` 顺序追加模式使用同一个 `GridDatasource` 协议，但增加有界并发、请求去重、优先级、取消、退避抖动、滚动方向预取和 LRU 缓存。

## 最小配置

```ts
import type { GridOptions } from "@agile-team/mach-table-vue";

export const options: GridOptions<Order> = {
  columnDefs,
  rowData: [],
  rowKey: "id",
  datasourceMode: "block",
  datasourceRowCount: 1_000_000,
  blockSize: 200,
  maxBlocksInCache: 12,
  datasourceMaxConcurrentRequests: 4,
  blockPrefetch: 1,
  datasourceRetryCount: 2,
  datasourceRetryDelay: 300,
  datasourceRetryJitter: 0.15,
  datasource: {
    async getRows(params) {
      try {
        const result = await orderApi.list({
          offset: params.startRow,
          limit: params.endRow - params.startRow,
          sort: params.sortModel,
          filters: params.filterModel,
          advancedFilter: params.advancedFilterModel,
          keyword: params.quickFilterText,
          signal: params.signal
        });
        params.onSuccess(result.rows, result.total);
      } catch (error) {
        if (!params.signal.aborted) params.fail(error);
      }
    }
  }
};
```

`datasourceRowCount` 让表格在首个请求前就建立正确滚动范围，适合已知总量或能廉价取得 count 的接口。若省略，范围会随已加载块逐步扩展；此时不能在尚未形成的滚动范围内直接跳到很远的位置。服务端返回准确总量后，应始终通过 `onSuccess(rows, total)` 传回。

## 主动加载与诊断

```ts
const controller = new AbortController();

await api.rows.ensureLoaded(20_000, 20_400, {
  signal: controller.signal
});

console.info(api.rows.getCacheSnapshot());
// {
//   cachedBlockCount, loadingBlockCount,
//   activeRequestCount, queuedRequestCount, cachedRowCount,
//   hitCount, missCount, evictionCount
// }

api.rows.purgeCache();
await api.reload({ signal: controller.signal });
```

平面兼容方法 `ensureRowsLoaded()`、`purgeDatasourceCache()`、`getDatasourceCacheSnapshot()` 与上述领域 API 等价。

## 行为边界

- 未加载行是稳定的 `RowNode` 占位对象：`loading: true`、`data: null`。内核显示轻量骨架，不调用业务 renderer/editor，也不允许选择。
- `getDisplayedRowCount()` 返回远程总量；`forEachNode()`、`getSelectedRows()` 和导出只处理当前已加载并留在缓存中的真实行。全量服务端导出应调用业务导出接口，而不是遍历浏览器缓存。
- 随机块模式使用固定 `rowHeight` 计算任意远程位置。`getRowHeight`、autoHeight、主从详情和本地分组不应与该模式组合；这些场景需要服务端模型或顺序模式。
- LRU 淘汰只移除行数据与 DOM 可达引用，稳定选择 ID 仍由 SelectionService 管理；重新加载同一 ID 后会恢复选中状态。
- 排序、普通/高级过滤和快速搜索变化会取消旧请求、清空块缓存并从第 0 块重新加载，乱序响应不会污染新查询。
- `ensureRowsLoaded()` 的主动加载优先级高于视口预取；并发达到上限后请求在内存队列中等待，调用方取消时不会继续占用网络槽位。

## 参数建议

| 场景 | `blockSize` | `maxBlocksInCache` | `blockPrefetch` | 最大并发 |
| --- | ---: | ---: | ---: | ---: |
| 普通后台列表 | 100–200 | 8–12 | 1 | 4 |
| 高延迟接口 | 200–500 | 12–20 | 1–2 | 4–6 |
| 低内存终端 | 50–100 | 4–6 | 0 | 2 |

缓存容量应根据单行对象大小、renderer 成本和目标设备实测。预取越大并不一定越快，它会增加带宽与后端并发；默认 `1` 是保守值。
