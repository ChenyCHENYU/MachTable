# @agile-team/mach-table-xlsx

MachTable 的可选 XLSX 导入导出扩展。工作簿引擎由宿主动态注入，因此普通表格页面不会下载 Excel 代码。

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

扩展复用 Core 的选择范围、表头、公式注入防护和安全导入规则。`xlsx` 只是示例引擎，不是本包的捆绑依赖；可注入经过项目批准的兼容引擎。

文档：[XLSX 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/xlsx.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
