# 可选数据分析、Pivot 与公式

`/analysis` 提供独立的有界 Pivot 和逐记录公式计算，也提供直接挂到现有表格旁的数据分析面板。普通 CRUD 表格无需加载这些实现。

## 一次挂载分析面板

```ts
import { mountAnalysis } from '@agile-team/mach-table/analysis';
import '@agile-team/mach-table/styles/workbench.css';

const panel = mountAnalysis(host, {
  api,
  pivot: {
    rowFields: ['department'],
    columnFields: ['status'],
    values: [
      { field: 'amount', aggregate: 'sum', label: '金额合计' },
      { aggregate: 'count', label: '记录数' }
    ]
  },
  formulas: { subtotal: '[quantity] * [price]' }
});

// 页面区域卸载时释放；表格销毁也会释放面板。
// panel.destroy();
```

| 使用环境 | 函数与类型入口 | 样式入口 |
| --- | --- | --- |
| Core | `@agile-team/mach-table/analysis` | `@agile-team/mach-table/styles/workbench.css` |
| Vue | `@agile-team/mach-table-vue/analysis` | `@agile-team/mach-table-vue/styles/workbench.css` |
| React | `@agile-team/mach-table-react/analysis` | `@agile-team/mach-table-react/styles/workbench.css` |

Vue/React 使用本适配包的子入口即可，不需要另装 Core。API 就绪后挂载，实例替换或组件卸载时调用 `destroy()`；生命周期、焦点恢复和主题刷新与[可选工作台](/recipes/workbench)相同。`refresh()` 重绘控件和已有结果，重新计算请在面板点击“运行分析”。数据更新后会提示结果已过期，不在每次编辑时自动重算。

面板从 `api.rows.forEach()` 收集当前模型中已加载的普通数据行，排除分组、明细和占位行；它不是“当前筛选后可见行”或“服务端全部结果”的统计。最多分析前 10000 条已加载记录，截取时显示范围提示。远程模式只分析缓存内已加载数据，不能把其合计作为服务端总计；全量统计请由服务端聚合后提供。

面板可配置多个行/列维度、聚合指标、公式列，以及柱状图/折线图。图表每次显示一个结果指标、最多前 40 个行组，并注明范围；完整结果以每页 50 组的数据表提供，保留合计和数值。它是有限的原生 SVG 展示，不包含外部图表引擎、交叉筛选或 BI 仪表盘协议。

## 独立 Pivot 计算

不需要面板时可以直接使用计算函数，无需 DOM 或样式：

```ts
import { createPivot } from '@agile-team/mach-table-vue/analysis';

const result = createPivot(orders, {
  rowFields: ['department'],
  columnFields: ['status'],
  values: [{ field: 'amount', aggregate: 'avg', label: '平均金额' }]
});
// result.columns: 动态结果列，含稳定 id、维度、指标和 total 标记
// result.rows: 行维度分组及以结果列 id 索引的 values
// result.totals: 从原始记录重新聚合的总计，平均值按有效数值加权
// result.inputCount: 实际输入记录数
```

支持 `sum`、`count`、`avg`、`min`、`max`。`count` 统计记录条数，包括指标字段为空的记录；数值聚合只接受有限 number，数值字符串不自动转换。没有有效数值的单元格返回 `null`，缺失的计数返回 `0`。存在列维度时会额外产生各指标的合计列。

维度支持 string、有限 number、boolean、null 和有效 Date；Date 转成 ISO 字符串，undefined 归为空值。类型不同的维度不会混为同一组。字段可使用安全嵌套路径；函数不会修改输入行。

计算上限是 10000 条输入、合计 12 个行/列维度、1–16 个指标、2000 个结果行组和 128 个结果列。超出明确抛错，不自动隐藏结果。相同字段与聚合方式的指标不能重复。输出列由动态结果标识，接回表格时应使用返回的 `column.id`，不能自行拼接显示标题当作 ID。此函数不管理服务端 Pivot 结果列、表格列状态或多级小计展开。

## 安全的逐记录公式

```ts
import { evaluateFormulas } from '@agile-team/mach-table-react/analysis';

const { rows, errors } = evaluateFormulas(orders, {
  subtotal: '[quantity] * [price]',
  payable: '[subtotal] - [discount]',
  score: 'MAX(0, [payable])'
});
// rows 是浅拷贝的新记录，不会写入原表格或自动产生 dirty。
// errors: [{ rowIndex, colId, code, message }]
```

语法支持数值、`[字段]`、安全字段名称、括号、一元正负、`+ - * / % ^`，以及大小写不敏感的 `SUM` / `MIN` / `MAX` / `AVG`。可以以 `=` 开头；`^` 为幂且从右向左结合。函数参数均来自当前记录，`SUM([a], [b])` 不表示跨行求和。

结果列 ID 是新记录上的安全单层属性，可使用中文（如 `税额`）；不能包含 `.`、`[` 或 `]`，也不能使用 `__proto__`、`prototype`、`constructor`。例如，应把 `{ taxTotal: '[tax.total] * 2' }` 的结果交给 Pivot 的 `field: 'taxTotal'`；`{ 'tax.total': '…' }` 会直接抛出 `SYNTAX`，不会写入嵌套对象。输入字段引用仍支持安全的点路径（如 `[tax.total]`）。计算保留未更改的嵌套对象引用，不会向源记录或其嵌套对象写值。

公式结果可引用同批次其他公式列，循环依赖会报告错误。原始字段必须是有限 number，不把字符串、null 或布尔值隐式当数值。语法、未知字段、非数值、除零、循环和非有限结果会以 `SYNTAX` / `UNKNOWN_FIELD` / `NON_NUMERIC` / `DIV_ZERO` / `CYCLE` / `NON_FINITE` 定位到行与结果列，失败结果为 `null`；其他无关公式可继续计算。输入规模或结果列名不合法会直接抛错。

每批最多 32 个公式列、10000 条记录、100000 个结果单元格；每个表达式最多 4096 字符、256 个 token、32 层嵌套。公式不执行 JavaScript，不支持 A1 地址、跨行/跨表引用、日期文本函数、Excel 工作簿或服务器公式执行。分析面板遇到公式错误会显示位置并移除旧分析结果，避免用旧图表冒充当前结果。

## 可访问性与验证范围

图表提供可访问名称，同时提供完整数值表；不能仅依靠颜色或折线形状理解结果。自动化覆盖聚合/公式边界、面板交互、SVG 名称、数据表与键盘焦点；它不能替代真实读屏、复杂业务统计口径或大规模服务端分析验收。NVDA / JAWS / VoiceOver 真人验收仍需按[可访问性矩阵](/advanced/accessibility)记录。
