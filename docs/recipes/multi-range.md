# 可选多范围选区

`/multi-range` 在 Core 的活动矩形选区上增加 Ctrl / Cmd 追加选区、复制与批量清空。它复用表格现有读取格式、输入校验、dirty 和撤销事务，不另建编辑模型。

## 安装一个表格专属 feature

```ts
import { createGrid } from '@agile-team/mach-table';
import { createMultiRangeSelection } from '@agile-team/mach-table/multi-range';
import '@agile-team/mach-table/styles/workbench.css';

const ranges = createMultiRangeSelection();
const api = createGrid(host, {
  rowKey: 'id',
  rowData,
  columnDefs,
  enableRangeSelection: true,
  features: [ranges]
});
```

Vue / React 仅从本适配包导入，并将同一个 feature 实例放进表格配置：

```ts
// Vue：在组件 setup 中创建一次。
import { createMultiRangeSelection } from '@agile-team/mach-table-vue/multi-range';
import '@agile-team/mach-table-vue/styles/workbench.css';
const ranges = createMultiRangeSelection();
const options = { enableRangeSelection: true, features: [ranges] };
```

```tsx
// React：保持 feature 与 features 数组引用稳定。
import { useMemo } from 'react';
import { MachTable } from '@agile-team/mach-table-react';
import { createMultiRangeSelection } from '@agile-team/mach-table-react/multi-range';
import '@agile-team/mach-table-react/styles/workbench.css';

function Orders() {
  const ranges = useMemo(() => createMultiRangeSelection(), []);
  const features = useMemo(() => [ranges], [ranges]);
  return <MachTable rowData={rows} columnDefs={columns} rowKey="id"
    enableRangeSelection features={features} />;
}
```

普通表格仍需正常的 `styles.css`；附加选区轮廓位于可选 `styles/workbench.css`，与工作台共用这一份附加样式。一个 feature 只能同时属于一个表格，不要把实例放进全局配置供多个表格复用。必须同时启用 `enableRangeSelection`；销毁表格或替换 `features` 时会释放监听、Observer、绘制帧和选区。

## 鼠标与键盘行为

| 操作 | 行为 |
| --- | --- |
| 普通鼠标框选 | 开始新的活动矩形，移除之前追加的范围 |
| Ctrl / Cmd + 鼠标框选 | 保留当前矩形并追加新的活动矩形 |
| Shift 操作 | 沿用 Core 的活动矩形扩展行为 |
| Ctrl / Cmd + C、X | 复制多个范围；剪切同时尝试清空可修改单元格 |
| Delete / Backspace | 多范围存在时尝试清空这些范围 |
| Escape | 清除全部范围 |

编辑器内的复制、剪切和删除仍归编辑器处理。附加范围用轮廓标出，强制颜色模式保留系统选区轮廓。Core 继续拥有当前活动矩形与填充柄；粘贴和填充只按现有活动矩形规则工作，不会把一个剪贴板块广播到所有附加范围。

## 编程操作

```ts
ranges.setRanges([
  { row1: 0, row2: 2, colId1: 'name', colId2: 'amount' },
  { row1: 6, row2: 7, colId1: 'amount', colId2: 'amount' }
]);
const selected = ranges.getRanges();
const text = ranges.getText();
ranges.clearValues();
// api.editing.undo(); // 成功的批量清空作为一次撤销事务
ranges.clear();
```

`row1/row2` 是当前显示模型的下标，列按当前可见顺序（左固定、普通、右固定）解释。范围会夹取有效行区间；找不到的列或无效区间不会安装。只收集已加载的普通数据行，排除分组、明细和加载占位行，不会为选区下载远程记录。虚拟 DOM 复用时按稳定行/列 ID 绘制；模型更新时清除选区，避免筛选、重排或同 ID 换数后误操作另一批记录。

`getText()` 返回每个矩形的 TSV，矩形之间用一个空行分隔；复制值沿用 Core 的复制/格式化规则。它不输出结构化多范围 MIME。重叠矩形复制时各自保留内容；清空时按行/列 ID 去重，同一格只写一次。`suppressClipboard` 会阻止原生多范围复制/剪切接管，显式调用 `getText()` 仍可取得文本。

清空通过共享用户输入边界，遵守 editable、转换及同步/异步单元格和整行校验。拒绝某一行时保留这一行，其他有效行可以成功；成功项共同形成一次撤销。`clearValues()` 返回 `void`，异步校验完成后才提交，不能把调用返回当作已全部清空；请通过现有变更/错误事件或 dirty 状态反馈结果。剪切已复制文本不代表清空一定通过校验。

最多保留 32 个矩形，单次范围操作最多覆盖 100000 个单元格；预算按各矩形大小相加，重叠部分也计入预算。超限抛出 `RangeError`，`setRanges()` 会保留此前合法选区。它不提供跨查询持久选区、多个活动填充柄或电子表格公式引用。自动化 DOM/键盘检查与真实辅助技术朗读是不同验收项目，见[可访问性与键盘](/advanced/accessibility)。
