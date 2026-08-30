# 性能指南

## 内核已做的（你不用操心）

| 机制 | 说明 |
| --- | --- |
| 行虚拟化 | 行池复用（`index % poolSize` 槽位 + `index+nodeId` 双校验），滚动只更新 diff |
| 列虚拟化 | 20+ 列自动启用可视列窗口（±2 列缓冲），离窗富组件主动卸载 |
| 变高行前缀和 | `Float64Array` 缓冲复用（几何扩容，滚动零分配）+ 二分定位 |
| 预取值排序 | Schwartzian 变换预提取排序键，避免 O(n log n) 次 valueGetter |
| 合帧与去重 | rAF 滚动合帧、className/title/style 写入前比较、`contain: layout style` |
| 范围缓存 | 框选坐标帧内缓存（8 个变更点失效），高亮零额外分配 |
| Renderer 原地刷新 | 同一行/列/renderer 优先调用 `refresh(params)`；Vue/React 更新现有组件 root，失败才安全重建 |
| 有界性能诊断 | 最近 120 次视口渲染滚动窗口，公开平均/P95/最大耗时、长帧数和实际 DOM 范围 |

## 数据侧最佳实践

### 1. 一定要提供 getRowId

编辑/选择/撤销/行池复用全部依赖稳定 id；缺失时 `setRowData` 后行池整体重建。

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

### 5. 增量更新优先 applyTransaction

```ts
api.applyTransaction({ update: [changedRow] });   // 局部刷新
// 而不是 rows[i] = x; api.setRowData(rows);       // 全量重建
```

实时行情、设备遥测和 WebSocket 推送应使用异步事务合批：

```ts
await Promise.all(messages.map((row) =>
  api.applyTransactionAsync({ update: [row] })
));
```

默认 16ms 内的事务保持顺序执行，但过滤/排序/分组/布局管线只刷新一次。可用 `asyncTransactionWaitMillis` 调整窗口，或调用 `flushAsyncTransactions()` 立即提交。

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

Playwright 的 Chromium 性能门禁固定验证 10 万行 × 100 列：初次构建、1000 次异步更新、滚动后的 DOM 上限和 P95 视口渲染预算均有保守 CI 阈值。可单独运行：

```bash
pnpm test:performance
```

生产问题可采集不含业务行数据的快照：

```ts
api.resetPerformanceMetrics();
// 执行需要测量的滚动或批量更新
const metrics = api.getPerformanceSnapshot();
// { sampleCount, averageRenderMs, p95RenderMs, maxRenderMs,
//   longRenderCount, renderedRows, renderedColumns, renderedCells }
```

`getDiagnostics().performance` 返回同一份指标，适合接入内部诊断面板。它是轻量观测，不替代 Chrome trace、内存 profile 或真实业务 UAT。绝对耗时受硬件、浏览器、renderer 与数据形态影响，请在目标设备用业务列模型复测，不把 README 数字当 SLA。

## 发布体积预算

`pnpm check:size` 在构建后检查 gzip 产物，CI/本地 `pnpm verify` 使用相同门槛：

| 产物 | gzip 上限 |
| --- | ---: |
| `@agile-team/mach-table` ESM | 80 KB |
| Vue 全部 ESM 产物 / 默认入口 / 工作流入口 / 可选编辑器 | 10.5 KB / 6.75 KB / 5 KB / 3 KB |
| React 全部 ESM / 默认入口 / 工作流入口 | 8 KB / 6.25 KB / 5 KB |
| Core CSS | 6 KB |

框架包把 Vue、React、ReactDOM 和 Core 声明为 external/peer dependency，因此 Vue 应用不会打入 React 适配代码，反之亦然。

## 常见性能反模式

1. `onCellClicked` 里同步做重活（改用事件内标记 + rAF/防抖）
2. 每次过滤变更全量 `setRowData`（用 `setFilterModel`，管线增量）
3. 在 `getRowHeight` 里做 DOM 测量
4. 对 10 万行开 `autoSizeAllColumns`（取样上限 2000 行，但宽列扫描仍 O(可见×列)）
