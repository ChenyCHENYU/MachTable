# 无限滚动（服务端分页）

本页描述默认 `datasourceMode: "sequential"` 的顺序追加模型。需要滚动条任意跳转、并发区块与 LRU 缓存时，改用[随机访问远程数据源](/recipes/random-access-datasource)；两种模式共享 `GridDatasource` 请求协议。

滚动条按**服务端总行数**撑满，滚动到已加载区末尾附近自动预取下一块——用户感知是一张完整的大表。

## 数据源协议

```ts
import type { GridDatasource } from "@agile-team/mach-table";

const datasource: GridDatasource<Order> = {
  getRows({ startRow, endRow, sortModel, filterModel, quickFilterText, signal, onSuccess, fail }) {
    fetch(`/api/orders?offset=${startRow}&limit=${endRow - startRow}`, { signal })
      .then((r) => r.json())
      .then(({ rows, total }) => onSuccess(rows, total))  // total = 服务端总行数
      .catch(fail);
  }
};

createGrid(host, {
  columnDefs,
  datasource,
  blockSize: 100,            // 每块请求行数
  infiniteBufferRows: 40,    // 距末尾 N 行预取
  datasourceRetryCount: 2,   // 瞬时故障自动重试
  datasourceRetryDelay: 300, // 300ms、600ms 后重试
  statusBar: true,           // 行数面板显示 "已加载 / 总数"
  rowKey: "id"
});
```

- 提供了 `datasource` 即进入无限模式，`rowData` 被忽略
- `lastRow` 可选：传非负总数时精确撑开滚动条；未传或传 `-1` 时按块继续请求，短块/空块自动判定结束
- 每次请求携带 `AbortSignal`；重载、排序/过滤变化或销毁时旧请求会被取消，过期响应不会覆盖新数据
- `fail(error)` 或 Promise reject 会按指数退避自动重试；只在次数耗尽后触发 `gridError / DATA_SOURCE_ERROR`
- 重载、排序/过滤变化或销毁同时取消等待中的重试定时器
- 当前采用顺序块加载；拖到远处时从已加载末尾继续补块，不会并发制造中间空洞

## 排序 / 过滤联动

表头排序、列过滤、快速过滤变更时**自动携带参数从第 0 行重载**：

```ts
// 服务端收到的参数示例
{ startRow: 0, endRow: 100,
  sortModel: [{ colId: "amount", direction: "desc" }],
  filterModel: { status: { type: "set", values: ["运行中"] } },
  quickFilterText: "华东" }
```

后端 SQL 翻译示例：`sortModel → ORDER BY`，`filterModel → WHERE`，`startRow/endRow → LIMIT/OFFSET`。

## 选中保持

选中按 `rowKey` 跨块保留；`api.rows.reload()` / 排序过滤重载后依然有效：

```ts
api.selection.setById("r5");
await api.rows.reload();
api.rows.getById("r5")?.selected;   // true（若该块被重新加载）
api.selection.getIds();              // 完整选中集合（含未加载块）
```

## 语义边界

| 场景 | 行为 |
| --- | --- |
| 表头全选 | 仅选已加载行；未加载完呈半选态 |
| CSV 导出 | 仅已加载行（全量导出请走后端） |
| 行合并 / 行分组 | 无限模式暂不支持 |
| `rows.setData` / `rows.transact` | 无限模式忽略，请用 `api.rows.reload()` |
| 编辑 / 粘贴 / 填充 | 正常（仅作用于已加载行），撤销栈通用 |
| 未加载行行高 | 固定 `rowHeight`（`getRowHeight` 仅对已加载行生效） |

## API

```ts
api.rows.isRemote();      // 是否无限模式
await api.rows.reload();    // 从第 0 行重载并等待首块完成（沿用当前排序/过滤）
```

## UI 反馈

加载中在表格底部显示浮动指示条（文案走 i18n `loading` 键）；首屏加载期间显示空数据区之外的区域骨架。

## 常见后端对接错误

1. **未知总量却始终返回满块** → 网格会继续请求；最后一页应返回短块/空块，或明确传 `lastRow`
2. **`lastRow` 与实际行数不符** → 滚动定位抖动；请确保 `onSuccess(rows, total)` 的 total 精确
3. **排序/过滤后 total 变化** → 每次响应都带最新 total，网格自动修正滚动条
