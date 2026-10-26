<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-xlsx

MachTable 0.33.0 的可选 XLSX 导入导出扩展。工作簿引擎由宿主动态注入，因此普通表格页面不会下载 Excel 代码。

```bash
pnpm add @agile-team/mach-table-xlsx xlsx
```

```ts
import { createXlsxExtension } from "@agile-team/mach-table-xlsx";

const excel = createXlsxExtension(() => import("xlsx"));

await excel.export(api, {
  fileName: "orders.xlsx",
  sheetName: "Orders"
});

await excel.import(api, await file.arrayBuffer(), {
  sheet: 0,
  mode: "replace",
  coerceNumbers: true
});
```

0.33.0 与 Core/Vue/React 固定版本组同步发布。默认导出通过 `io.exportMatrix({ target: "xlsx" })`，默认导入使用原始单元格和 `cellDates: true`；数值、布尔、Date 与长标识无需格式化 CSV 往返。已有 `transformCell` / `parseValue` 字符串回调仅在显式配置时执行。需要整批业务校验和可审阅预览时，先读取矩阵并使用 Core/Vue/React 的可选 `/import` 计划。直接导入的 replace/append 同步装载经 parser 规范化的记录，不运行交互校验；paste 复用交互校验与撤销管线，boolean 不代表异步校验完成。

扩展复用 Core 的选择范围、表头、公式注入防护和安全导入规则。`xlsx` 只是示例引擎，不是本包的捆绑依赖；可注入经过项目批准的兼容引擎。

文档：[XLSX 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/xlsx.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
