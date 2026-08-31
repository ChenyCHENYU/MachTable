# 性能指南

## 内核已做的（你不用操心）

| 机制 | 说明 |
| --- | --- |
| 行虚拟化 | 行池复用（`index % poolSize` 槽位 + `index+nodeId` 双校验），滚动只更新 diff |
| 列虚拟化 | 20+ 列自动启用；表头与正文共享前缀宽度索引 + 二分窗口定位（±2 列缓冲），不保留离窗表头 DOM |
| 变高行索引 | Fenwick 树维护高度与偏移；单行变化 O(log n) 更新、O(log n) 定位，无需重建完整前缀数组 |
| 预取值排序 | Schwartzian 变换预提取排序键，避免 O(n log n) 次 valueGetter |
| 合帧与去重 | rAF 滚动合帧、className/title/style 写入前比较、`contain: layout style` |
| 范围缓存 | 框选坐标帧内缓存（8 个变更点失效），高亮零额外分配 |
| Renderer 原地刷新 | 同一行/列/renderer 优先调用 `refresh(params)`；Vue/React 更新现有组件 root，失败才安全重建 |
| 原子更新调度 | `api.batch()` 合并列/行池/布局/数据/脏单元格/固定行/合计/overlay；诊断公开请求与合并次数 |
| 有界性能诊断 | 最近 120 次渲染/布局/模型窗口，公开 P95、长帧、DOM 范围和可用 JS 堆指标；所有表格共享一个 Long Tasks Observer |
| 布局隔离与释放 | Root/Row 使用 `contain: layout style`，销毁时主动释放行池、几何缓存、Worker、Observer 和请求 |

## 数据侧最佳实践

### 远程大数据优先使用随机块模式

需要滚动条任意跳转时使用 `datasourceMode: "block"`，并配置 `datasourceRowCount`、稳定 `rowKey`、有界 `maxBlocksInCache`。默认最多并行 4 个块请求，显式 `api.rows.ensureLoaded()` 优先于预取，预取先沿当前滚动方向执行，重试使用指数退避与抖动；普通“继续加载”列表保持默认 `sequential` 即可。详见[随机访问远程数据源](/recipes/random-access-datasource)。

### 大型本地计算按证据启用 Worker

`dataProcessor` 只在超过 `dataProcessorMinRows` 且发生本地排序/过滤时启用。标准字段 Processor 不序列化函数，适合普通 `field`；复杂 valueGetter/comparator 应预计算或使用自定义 Processor。Worker 有数据复制成本，不要把它作为所有表格的默认配置。详见[Worker 数据处理](/advanced/worker-processing)。

### 1. 一定要提供稳定 rowKey

编辑/选择/撤销/行池复用全部依赖稳定 id；缺失时 `api.rows.setData()` 后行池整体重建。

### 2. 大数据量分档

| 规模 | 推荐 |
| --- | --- |
| ≤ 2 万行 | 客户端模式直接给 |
| 2 ~ 10 万行 | 客户端可用；高频过滤建议 `manualFiltering` + 服务端 |
| \> 10 万 / 未知总量 | `datasource` 无限滚动 |

### 3. valueGetter 保持纯且轻

排序/过滤/渲染都会调用它。避免在其中创建对象、做正则重活。需要派生字段时预计算进数据。

### 4. cellRenderer 返回字符串或 HTMLElement

框架组件适配器（reactCellRenderer/vueCellRenderer）每个可见单元格一个 root——仅用于富交互单元格；纯格式化用 `valueFormatter`。

### 5. 增量更新优先 `api.rows.transact()`

```ts
api.rows.transact({ update: [changedRow] });   // 局部刷新
// 而不是 rows[i] = x; api.rows.setData(rows); // 全量重建
```

实时行情、设备遥测和 WebSocket 推送应使用异步事务合批：

```ts
await Promise.all(messages.map((row) =>
  api.rows.transactAsync({ update: [row] })
));
```

默认 16ms 内的事务保持顺序执行，但过滤/排序/分组/布局管线只刷新一次。可用 `asyncTransactionWaitMillis` 调整窗口，或调用 `api.rows.flushTransactions()` 立即提交。

同一个用户动作还会修改列、数据和视图时，使用同步 `api.batch()`：

```ts
api.batch((grid) => {
  grid.rows.transact({ update: rows });
  grid.columns.setVisible("cost", canViewCost);
  grid.view.refreshCells({ rowIds, columns: ["status"] });
});
```

## 渲染侧调优

| 手段 | 说明 |
| --- | --- |
| `rowBuffer: 4` | 快速滚动场景可降到 4（默认 8）减少 DOM |
| 列数 < 20 | 列虚拟化不启用（无收益），列多时自动开启无需配置 |
| `suppressRowHoverHighlight` | 极端场景关闭 hover 三窗格同步 |
| 慎用 autoRowSpan | 行合并需在每次管线刷新时比较相邻值，超长同值列收益最高 |
| `getRowHeight` 轻量化 | 见[变高行](/recipes/variable-height)的性能提示 |

## 测量基准

可复现基准见 `examples/bench`（`pnpm --filter bench-demo dev`）：1k/10k/100k 行 × 8/30/60/100 列，含状态/进度/操作预设列，自动滚动统计帧耗时与可见 DOM 计数。

Playwright 的 Chromium 性能门禁固定验证 10 万行 × 100 列、60 帧连续纵向滚动、1 万行 × 500 列横向跳转和 30 次重复挂载/销毁：初次构建、1000 次异步更新、DOM 上限、P95 视口渲染和生命周期均有保守 CI 阈值。可单独运行：

```bash
pnpm test:performance
```

生产问题可采集不含业务行数据的快照：

```ts
api.diagnostics.resetPerformance();
// 执行需要测量的滚动或批量更新
const metrics = api.diagnostics.getPerformance();
// { sampleCount, averageRenderMs, p95RenderMs, maxRenderMs,
//   layoutSampleCount, p95LayoutMs, modelSampleCount, p95ModelMs,
//   longRenderCount, longTaskCount, longTaskTotalMs, usedHeapBytes,
//   renderedRows, renderedColumns, renderedCells }
```

`api.diagnostics.get().performance` 返回同一份指标，适合接入内部诊断面板。它是轻量观测，不替代 Chrome trace、内存 profile 或真实业务 UAT。绝对耗时受硬件、浏览器、renderer 与数据形态影响，请在目标设备用业务列模型复测，不把 README 数字当 SLA。

## 发布体积预算

`pnpm check:size` 在构建后检查 gzip 消费体积；`pnpm check:release-artifacts` 检查解压产物并阻止 sourcemap 进入 npm 发布包。CI/本地 `pnpm verify` 使用相同门槛：

| 产物 | gzip 上限 |
| --- | ---: |
| `@agile-team/mach-table` 全公开 ESM / `createGrid` 真实消费 | 86 KiB / 79 KiB |
| 可选 `/worker` ESM | 8 KiB |
| Vue 全部 ESM 产物 / 默认入口 / 工作流入口 / 可选编辑器 | 10.5 KiB / 6.75 KiB / 5 KiB / 3 KiB |
| React 全部 ESM / 默认入口 / 工作流入口 | 8 KiB / 6.25 KiB / 5 KiB |
| Core CSS | 7 KiB |

日常只验证运行时代码可执行 `pnpm build:runtime`，跳过耗时的声明汇总；正式包必须执行 `pnpm build:release`，保留 `.d.ts` 但不发布约占旧包 70% 解压空间的 `.map`。项目仍使用 tsup + esbuild：当前瓶颈是 TypeScript 声明汇总，不是 JS 打包，因此没有为了工具潮流迁移到 tsdown。

0.24 没有增加名不副实的 `/lite`：当前可选 Worker、工作流、UI、适配器、编辑器和 XLSX 已是独立子入口，业务 bundler 会按 import tree-shake；再复制一个能力残缺但内核相同的 Lite 入口不会降低实际应用体积，只会制造第二套 API。只有拆分后能在真实 Vue/React 消费样本中稳定减少至少 20% gzip，才会增加该入口。

框架包把 Vue、React、ReactDOM 和 Core 声明为 external/peer dependency，因此 Vue 应用不会打入 React 适配代码，反之亦然。

## 常见性能反模式

1. `onCellClicked` 里同步做重活（改用事件内标记 + rAF/防抖）
2. 每次过滤变更全量 `rows.setData`（用 `filtering.setModel`，管线增量）
3. 在 `getRowHeight` 里做 DOM 测量
4. 对 10 万行开 `autoSizeAllColumns`（取样上限 2000 行，但宽列扫描仍 O(可见×列)）
