# 可选 XLSX 导入导出

XLSX 不进入 Core，也不会随 Vue/React 适配包下载。只有确实需要 Excel 的页面才安装 `@agile-team/mach-table-xlsx` 和工作簿引擎，并通过动态导入加载。

```bash
pnpm add @agile-team/mach-table-xlsx xlsx
```

```ts
import { createXlsxExtension } from "@agile-team/mach-table-xlsx";

const excel = createXlsxExtension(() => import("xlsx"));

await excel.export(api, {
  fileName: "订单明细.xlsx",
  sheetName: "订单",
  onlySelected: false
});
```

第一次调用 `export()` / `import()` 才加载引擎。把扩展包与引擎都放在页面动态导入边界内，普通列表路由无需加载它们。导出直接使用 `api.io.exportMatrix({ target: "xlsx" })`，保留数字、布尔值、Date 和空值，不再经 CSV 大字符串往返；默认导出表头、可见列，并沿用公式注入防护。列 `valueSerializer` 可按 `target` 定义输出，见[列值政策](/recipes/column-values)。

扩展只转换浏览器已加载的数据。服务端分页和无限数据源的全部匹配结果请使用[服务端全量导出](/recipes/remote-export)，不要依赖 XLSX 桥接读取未加载行。

## 导入

```ts
const file = input.files?.[0];
if (file) {
  await excel.import(api, await file.arrayBuffer(), {
    sheet: 0,
    mode: "replace", // replace | append | paste
    headerRowIndex: 0,
    coerceNumbers: true
  });
}
```

导入先按 `engine.read(data, { cellDates: true, ...readOptions })` 读取工作簿，再通过 `sheet_to_json({ header: 1, raw: true })` 取得原始矩阵，直接交给 `api.io.importMatrix`。日期是否被识别为 Date 取决于宿主引擎，可用 `readOptions.cellDates` 覆盖默认值；不会从任意日期文本自动猜测时区或格式。数字若已在工作簿内损失精度，导入后无法恢复，长编号应在源文件中保存为文本。

`columns` 可指定矩阵顺序对应的列 ID / field；显式 columns 默认没有表头，否则默认第一行为表头，也可用 `headerRowIndex: -1` 指定无表头。列 ID 精确匹配优先于 field 和显示名，歧义及重复目标会拒绝。列 `valueParser` 接收原始 typed 单元格，按同一列值政策规范化数据。

replace / append 是受 parser 约束的同步记录装载，不运行交互 `validate`。paste 复用交互校验和撤销管线；其 boolean 返回值不代表异步校验已经完成。需要可审阅规范值、结构化错误及完整提交结果时，使用引擎读取矩阵后交给独立的[导入预览计划](/recipes/import-preview)。每次矩阵装载最多 10000 数据行、100000 单元格（包含表头），不静默截断。服务端大批量导入建议上传原文件并执行后端校验。

`separator` / `columnSeparator` 为旧参数兼容保留，对 XLSX 矩阵直通不再生效。下载文件名中的路径分隔符和平台非法字符仍会清洗，工作表名也会清洗并限制到 31 个字符。

## 显式字符串回调兼容

既有 `transformCell(value: string, rowIndex, columnIndex)` 和导入 `parseValue({ value: string, ... })` 保持字符串签名，仅在显式配置时转换。`transformCell` 返回 null/undefined 时沿用旧行为，保留传入的字符串；false、0、空字符串则作为实际结果保留。它们可覆写 typed 默认路径；单次 `parseValue` 优先于列 parser。使用列 `valueParser` / `valueSerializer` 时可直接处理 Date、number、boolean 等值，无需为恢复类型反复转换。

```ts
await excel.export(api, {
  // 兼容旧业务规则：此回调收到字符串，返回值决定实际工作表单元格类型。
  transformCell: (value, rowIndex, columnIndex) =>
    rowIndex > 0 && columnIndex === 1 && value !== "" ? Number(value) : value
});
```

未指定 transform 时，导出 typed matrix 原值。CSV/XLSX 的 `protectFormulas` 默认开启；只有业务明确需要原始公式文本时才关闭。

## 延迟结果与状态保护

XLSX 导入要求当前没有活动编辑或未保存改动，否则返回 `false`。加载引擎前记录输入意图；等待期间新的输入（包括尚未完成异步校验的粘贴）、开始编辑、单元格值或数据变化、更新的导入请求，都会使旧导入失效。引擎读取前后均检查作用域，`read()` 回调重入修改表格或销毁实例时也不会晚到覆盖。订阅无论成功、取消或抛错均释放。

返回 `false` 时，宿主应说明导入已取消或未被接受，让用户基于当前数据重新操作。引擎加载、工作簿结构和工作表选择错误以异常返回，宿主负责展示具体错误。导出在引擎加载后读取当前数据；若此时实例已销毁，会抛错并停止创建下载。它不提供冻结在调用时刻的全表快照。

## 引擎解耦

扩展只要求一个小型 `XlsxEngine` 协议，不硬编码 SheetJS 版本。企业可注入经过安全审批的兼容引擎或封装层：

```ts
const excel = createXlsxExtension(async () => approvedWorkbookEngine);
```

Core 继续保持零运行时依赖；可选桥接包本身也不携带工作簿引擎。版本升级时应分别检查 MachTable 扩展、引擎版本、CSP 和文件大小限制。
