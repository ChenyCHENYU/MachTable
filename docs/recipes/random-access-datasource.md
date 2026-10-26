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

## 超大逻辑高度

总行高超过 16,000,000px 时，表格自动把原生滚动范围映射到有界物理容器，行本身仍按真实高度绘制。普通规模继续使用直接坐标。`api.view.scrollToRow(index, "top" | "bottom" | "middle" | "nearest")`、键盘、固定列、范围填充和行拖拽复用同一转换；不需要业务侧换算索引或维护额外 spacer。

滚动条拖动按整个逻辑范围定位；滚轮/触控板的纵向 delta 在压缩模式下仍按逻辑像素处理，支持像素、行和页单位。横向 delta 保留，Shift 横滚与 Ctrl/Meta 缩放交给浏览器；到上下边界时保留原生滚动链。自定义编辑器如需独占滚轮，应自行 `preventDefault()`。原生触屏惯性滚动目前仍按物理滚动范围映射，触屏手感需另做真实设备验收。

有界坐标只解决远程末行可达和几何位置，不代表浏览器已加载一千万条记录，也不证明一千万行本地排序、聚合或所有交互的性能。本轮新增自动用例检查一千万行远程总量、稀疏缓存、末行与固定列对齐、定位/滚轮/键盘/填充/拖拽；三引擎实际执行结果以验收台账为准。只有真实已加载行参与编辑；未知总量依然只能在当前已知范围内定位。随机块模式仍要求固定行高，变高/树/明细使用相应本地或顺序模型，不能凭坐标转换消除它们的数据模型限制。`autoHeight` 渲染全部行，不使用这个有界滚动路径，不适合超大数据集。

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
await api.rows.reload({ signal: controller.signal });
```

随机块命令只通过 `api.rows.ensureLoaded()`、`api.rows.purgeCache()` 与 `api.rows.getCacheSnapshot()` 暴露。

## 行为边界

- 未加载行是稳定的 `RowNode` 占位对象：`loading: true`、`data: null`。内核显示轻量骨架，不调用业务 renderer/editor，也不允许选择。
- `api.rows.getCount()` 返回远程总量；`rows.forEach()`、`selection.getRows()` 和导出只处理当前已加载并留在缓存中的真实行。全量服务端导出应调用业务导出接口，而不是遍历浏览器缓存。
- 随机块模式使用固定 `rowHeight` 计算任意远程位置。`getRowHeight`、autoHeight、主从详情和本地分组不应与该模式组合；这些场景需要服务端模型或顺序模式。
- 缓存优先保留实际渲染范围（含缓冲）、焦点及活动编辑所在块。`maxBlocksInCache` 是常态预算；操作所需的保护范围较大时，最多保留保护块数加一个取数槽，保护解除后回到预算。关闭 `blockPrefetch` 只关闭推测预取，可见范围跨多块时仍会加载全部可见块。
- 淘汰块时，未保存行只保留稀疏节点供 `editing.getChanges()`、保存和回滚使用，不计入已加载行遍历或缓存行数；重新取回同 ID 时保留本地修改。保存或回滚后，下次缓存维护释放该额外节点。稳定选择 ID 独立保留，重新加载后恢复选中状态。
- 排序、普通/高级过滤和快速搜索变化会取消旧请求、清空块缓存并从第 0 块重新加载，乱序响应不会污染新查询。
- `reload()`、`purgeCache()` 和查询切换会替换数据作用域，取消编辑并清空旧作用域的脏状态与撤销历史；页面应在切换前按业务流程保存或回滚。旧保存请求完成后仍返回其原快照结果，但不会确认新作用域中同 ID 的修改。
- `ensureRowsLoaded()` 的主动加载优先级高于视口预取；并发达到上限后请求在内存队列中等待，调用方取消时不会继续占用网络槽位。

## 参数建议

| 场景 | `blockSize` | `maxBlocksInCache` | `blockPrefetch` | 最大并发 |
| --- | ---: | ---: | ---: | ---: |
| 普通后台列表 | 100–200 | 8–12 | 1 | 4 |
| 高延迟接口 | 200–500 | 12–20 | 1–2 | 4–6 |
| 低内存终端 | 50–100 | 4–6 | 0 | 2 |

缓存容量应根据单行对象大小、renderer 成本和目标设备实测。预取越大并不一定越快，它会增加带宽与后端并发；默认 `1` 是保守值。
