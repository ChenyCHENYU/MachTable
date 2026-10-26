# 列值政策与 typed IO

`valueParser` 负责把用户输入转为入库值，`valueSerializer` 负责剪贴板、CSV、XLSX 输出。显示仍由 `valueFormatter` 控制；排序、筛选、聚合和分析读取入库值，不为了这些操作重复解析或序列化。

```ts
import type { ColDef } from "@agile-team/mach-table";

type Item = { id: string; amount: number | null; day: Date | null; state: number | null };
const columns: ColDef<Item>[] = [
  { field: "id", editable: true, valueParser: ({ value }) => String(value ?? "") },
  { field: "amount", editable: true, filter: "number",
    valueParser: ({ value }) => value === "" || value == null ? null : Number(value),
    validate: value => value == null || Number.isFinite(value) ? null : "请输入有效金额" },
  { field: "day", editable: true, filter: "date",
    valueParser: ({ value }) => value === "" || value == null ? null : value instanceof Date ? value : new Date(String(value)),
    valueSerializer: ({ value, target }) => value == null ? "" : target === "xlsx" ? value : value.toISOString().slice(0, 10) },
  { field: "state", editable: true, filter: "set",
    valueParser: ({ value }) => value === "启用" || value === 1 ? 1 : value === "停用" || value === 0 ? 0 : null,
    valueSerializer: ({ value }) => value === 1 ? "启用" : value === 0 ? "停用" : "" }
];
```

## 优先级与执行边界

列配置按 `defaultColDef → columnTypes（数组从左到右）→ 显式 colDef` 合并，后者替换前者的整个回调。`columnTypes` 可保存上述政策，使用侧只写 `type`。

输入时，单次导入的 `parseValue` 优先于列 `valueParser`；未配置它们时沿用内置文本转换。编辑器的 `getValue()` 结果、剪贴板原始文本、CSV 字符串或 typed matrix 原始单元格，分别作为 parser 的 `value`。`source` 为 `editor`、`clipboard` 或 `import`，`oldValue` 供需要它的政策使用。导入新记录的上下文是隔离候选记录，不是同 ID 的现有记录。parser 应只规范当前字段，跨字段业务约束使用 `rowEditValidator` 的 `values`。

两个回调都必须同步、无副作用。需要远程检查时使用已有 `validate` / `rowEditValidator` 的 Promise。parser 抛错或返回 Promise 会拒绝输入；编辑器保留草稿，剪贴板拒绝该行并通过 `gridError` 报告。serializer 抛错或返回 Promise 会报告并终止输出，不输出错误占位值。回调可能被预览、失败重试多次调用，不能把调用次数当作业务提交次数。

编辑器与交互粘贴先解析，再用现有字段/整行规则校验；校验后的同一规范值进入 setter、事件与撤销记录。只读字段不会因交互粘贴而被解析或写入。清空、填充、undo/redo 已有规范值，不重新解析。可信的 `rows.setData` / `rows.transact` 保持原有语义，不运行 parser 或交互校验。过滤模型的参数应使用对应列的规范类型，parser 不改变过滤条件本身。

输出时，列 serializer 优先于内置策略。未配置时，剪贴板使用显示格式，CSV 保留数值原值、其他值使用显示格式，typed matrix/XLSX 使用原始值。`target` 是 `clipboard`、`csv` 或 `xlsx`。CSV 和 matrix 默认启用已有 `protectFormulas`；只有明确需要原始公式文本时才传 `false`。

## 数字、日期与空值

内置文本转换把空字符串变为 `null`。启用数字转换时只接受有限数值文本；前导零编号、超出安全整数范围的整数、`Infinity`、溢出指数文本保持字符串。`coerceNumbers: false` 保留非空文本。typed matrix 的 number、boolean、Date、null 直接保留，不先转换为字符串。

JavaScript `number` 仍遵循浮点语义，不能用这个政策承诺任意精度小数。长编号应配置字符串 parser；需要精确金额时可保存最小货币单位整数，或由业务 parser 保持规范小数字符串。不要先把超长编号交给 `Number()`，丢失的精度无法恢复。

日期不会从任意文本自动猜测。列 parser 明确输入格式、时区和空值规则，validate 检查无效 Date。XLSX 原本已以数值存储且损失精度的长编号也无法在导入后复原。

## 同步矩阵桥

```ts
import type { GridApi } from "@agile-team/mach-table";
declare const api: GridApi<Item>;

api.io.importMatrix([["0012", 12.5, new Date("2026-10-26"), 1]], {
  columns: ["id", "amount", "day", "state"], mode: "append"
});
const typed = api.io.exportMatrix({ target: "xlsx", includeHeader: true });
```

显式 `columns` 按矩阵顺序指定列 ID / field，默认没有表头；未提供时默认第一行为表头，`headerRowIndex: -1` 显式表示没有表头。列 ID 精确匹配优先于 field 和表头别名，重复目标或歧义别名报错。没有明确列名的旧 CSV/矩阵装载继续兼容可见列位置映射；需要严格映射和审阅时使用 [导入预览计划](./import-preview.md)。

`importMatrix` / `importCsv` 的 replace/append 是同步记录装载，受 parser 约束，不运行交互 validate；返回 boolean 不代表远程校验完成。paste 模式复用交互输入管线，异步校验可能稍后结束。每次最多 10000 数据行、100000 单元格（包含表头），不静默截断。整批解析失败不会装载部分新记录；远程行模型不支持该装载桥。

## XLSX 类型保留

`@agile-team/mach-table-xlsx` 使用 `exportMatrix({ target: "xlsx" })` 和 `sheet_to_json({ header: 1, raw: true }) → importMatrix`，不再生成 CSV 中间大字符串。读取默认 `cellDates: true`，可在 `readOptions` 覆盖；具体日期识别能力由宿主引擎提供。

既有 `transformCell(value: string)` 和 `parseValue({ value: string })` 保持字符串签名，仅在显式提供回调时使用旧字符串转换。列 parser/serializer 不受此兼容回调限制。`columnSeparator` / `separator` 对直接 XLSX 矩阵不再生效。

引擎延迟加载期间发生数据、单元格值或编辑意图变化时，导入停止并返回 `false`；销毁实例也不会回写。XLSX 导入要求当前没有活动编辑和未保存改动；需要保留 dirty 行并逐行审阅/部分粘贴时，将工作表矩阵交给 `/import` 计划。引擎装载失败仍以异常返回，宿主应在 UI 中呈现错误。
