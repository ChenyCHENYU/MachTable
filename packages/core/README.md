<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table

MachTable 0.25 的框架无关 TypeScript Core：零运行时依赖，提供行列双虚拟化、领域化 API、单元格/整行编辑、树与分组、随机访问远程数据、区段隔离状态持久化和可诊断扩展系统。

```bash
pnpm add @agile-team/mach-table
```

```ts
import { createGrid } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, {
  columnDefs: [
    { field: "id", headerName: "ID", width: 120 },
    { field: "name", headerName: "名称", flex: 1, editable: true }
  ],
  rowData: [{ id: "1", name: "MachTable" }],
  rowKey: "id",
  enableColumnResize: true,
  persistence: { key: "tenant:user:customers", sections: ["columns"] }
});

api.batch((grid) => {
  grid.rows.transact({ update: [{ id: "1", name: "Updated" }] });
  grid.columns.setVisible("internalNote", false);
  grid.view.refreshCells({ rowIds: ["1"] });
});

const saved = await api.editing.save(orderApi.saveChanges);
console.table(saved.conflicts);
console.info(api.diagnostics.get());

// 原生宿主卸载时必须销毁；Vue/React 适配器会自动处理。
api.destroy();
```

`persistence.sections` 同时约束进入 store 的数据与恢复范围；异步 store 写入有序，晚到加载不会覆盖加载期间的用户操作。

公共命令按 `rows`、`columns`、`selection`、`editing`、`filtering`、`sorting`、`pagination`、`hierarchy`、`view`、`state`、`io`、`diagnostics` 划分。完整签名见 [GridApi](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/api/grid-api.md)。

大型本地数据 Worker 使用独立入口：

```ts
import { createWorkerDataProcessor } from "@agile-team/mach-table/worker";
```

Vue/React 项目请只安装对应适配包，它会自动安装并重导出 Core：

- [@agile-team/mach-table-vue](https://www.npmjs.com/package/@agile-team/mach-table-vue)
- [@agile-team/mach-table-react](https://www.npmjs.com/package/@agile-team/mach-table-react)

文档：[快速开始](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/getting-started.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [API](https://github.com/ChenyCHENYU/MachTable/tree/main/docs/api)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
