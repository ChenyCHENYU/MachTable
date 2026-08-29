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

第一次调用 `export()` 才加载引擎；普通列表路由的初始 chunk 不包含 XLSX 代码。扩展复用 Core 的 CSV 序列化规则，因此默认保留表头、可见列和公式注入防护。

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

导入会先读取选定 Sheet，再复用 Core 的字段映射、路径安全和类型转换逻辑。服务端导入仍建议上传原文件并执行后端校验；浏览器导入适合预览、小批量录入和即时纠错。

`separator` / `columnSeparator` 仅接受单个非引号、非换行字符；扩展会使用同一分隔符完成工作表与 Core CSV 导入器之间的转换。下载文件名中的路径分隔符和平台非法字符会被清洗，避免把业务输入解释为本地路径。

## 引擎解耦

扩展只要求一个小型 `XlsxEngine` 协议，不硬编码 SheetJS 版本。企业可注入经过安全审批的兼容引擎或封装层：

```ts
const excel = createXlsxExtension(async () => approvedWorkbookEngine);
```

Core 继续保持零运行时依赖；可选桥接包本身也不携带工作簿引擎。版本升级时应分别检查 MachTable 扩展、引擎版本、CSP 和文件大小限制。
