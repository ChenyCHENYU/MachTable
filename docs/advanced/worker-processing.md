# Worker 数据处理

MachTable 默认在主线程完成本地过滤和排序，以保持小数据零异步成本。对于数万行以上、筛选频繁且服务端化暂不可行的页面，0.19 可将可序列化字段管线移入独立 Worker。

## 1. Worker 模块

```ts
// src/workers/mach-table.worker.ts
import {
  installGridDataWorker,
  type GridDataWorkerScope
} from "@agile-team/mach-table-vue/worker";

installGridDataWorker(self as unknown as GridDataWorkerScope);
```

## 2. 应用配置

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig } from "@agile-team/mach-table-vue";
import { createWorkerDataProcessor } from "@agile-team/mach-table-vue/worker";

export default defineMachTableConfig({
  defaults: {
    dataProcessorMinRows: 10_000,
    dataProcessor: createWorkerDataProcessor(
      () => new Worker(
        new URL("../workers/mach-table.worker.ts", import.meta.url),
        { type: "module", name: "mach-table-data" }
      )
    )
  }
});
```

该桥接不创建 Blob URL、不使用 `eval`，Worker URL 和 CSP 策略完全由宿主构建工具控制。Worker 按首次真正触发大数据过滤/排序时懒创建，Grid 销毁后默认自动 `terminate()`。

## 标准处理器的能力边界

`installGridDataWorker()` 使用列的 `field` 路径执行文本、数字、日期、集合、高级 AND/OR/NOT 过滤、快速搜索与稳定多列排序。它不会序列化函数，因此包含 `valueGetter`、自定义 comparator 或业务计算字段时，有两种正确方案：

1. 在进入表格前预计算成普通字段；
2. 实现自定义 `GridDataProcessor.process(request)`，在 Worker/服务端执行同一业务语义并返回最终 `rowIds`。

Processor 只在以下条件同时满足时启用：本地数据量达到阈值、存在本地排序或过滤、未启用 tree/master-detail/本地分组。未配置、低于阈值或不适合异步处理时继续走原同步管线。Processor 失败会写入 `gridError`，随后安全回退到主线程，不让表格停在半更新状态。

## 取消与竞态

每次模型变化都会中止上一任务。标准桥接向 Worker 发送 `mach-table:cancel`，字段处理器每 2,000 行协作让出事件循环并检查取消状态；迟到结果还会由 RowModel 序号二次隔离。业务自定义 Processor 必须监听 `request.signal`，不要把取消当作错误提示给用户。

Worker 会复制数据，收益取决于行对象体积和计算强度。请用真实列与设备比较主线程卡顿、总耗时和复制内存；仅几千行时 Worker 通常得不偿失。
