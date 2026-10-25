<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table

MachTable 0.31.2 的框架无关 TypeScript Core：零运行时依赖，提供行列双虚拟化、领域化 API、单元格/整行编辑、树与分组、随机访问远程数据、区段隔离状态持久化和可诊断扩展系统。本版统一用户输入校验，完善缓存与异步保存边界，并优化筛选计划和失效列排序。

```bash
pnpm add @agile-team/mach-table
```

```ts
import { createGrid, indexColumn } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, {
  columnDefs: [
    indexColumn({ headerName: "序号" }),
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

单元格编辑通过内置对勾/取消控件显式结束，普通鼠标和焦点变化不会误提交；Enter、Escape、Tab 仍提供完整键盘路径。筛选、列设置、上下文菜单和操作菜单会继承所属表格实例的主题变量，不受宿主页面全局样式影响。

编辑、粘贴、清空和填充共用已有列校验与整行校验，批量输入按行提交并合并撤销记录，异步校验不会写回已替换的数据。随机块缓存淘汰后，未保存行仍可通过编辑 API 保存或回滚；完整替换数据与重新查询会清理旧作用域的状态。

`loading: true` 默认展示轻量表格骨架与本地化状态文案，空数据默认展示内置插画；需要品牌化时再通过 `overlayLoadingTemplate`、`overlayNoRowsTemplate` 覆盖，基础页面无需重复实现 loading/empty DOM。

公共命令按 `rows`、`columns`、`selection`、`editing`、`filtering`、`sorting`、`pagination`、`hierarchy`、`view`、`state`、`io`、`diagnostics` 划分。完整签名见 [GridApi](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/api/grid-api.md)。

大型本地数据 Worker 使用独立入口：

```ts
import { createWorkerDataProcessor } from "@agile-team/mach-table/worker";
```

Vue/React 项目请只安装对应适配包，它会自动安装并重导出 Core：

- [@agile-team/mach-table-vue](https://www.npmjs.com/package/@agile-team/mach-table-vue)
- [@agile-team/mach-table-react](https://www.npmjs.com/package/@agile-team/mach-table-react)

## 行拖拽与条件整行颜色

```ts
import { dragColumn, type GridOptions } from "@agile-team/mach-table";

interface Plan { id: string; name: string; status: string }
const options: GridOptions<Plan> = {
  rowKey: "id",
  columnDefs: [dragColumn(), { field: "name" }, { field: "status" }],
  rowStyleRules: [
    { when: ({ data }) => data.status === "pending", tone: "warning" },
    { when: ({ data }) => data.status === "failed", tone: "danger" },
    { when: ({ data }) => data.status === "done", tone: "success" }
  ]
};
```

状态码由应用定义，包内不识别业务状态。颜色规则取第一条命中结果，未命中时沿用默认样式；支持自定义背景/文字颜色、固定列、明暗主题、选择和虚拟行复用。拖拽提供主题手柄、落点线、位置浮层、边缘滚动、Esc 取消和 Alt + ↑/↓ 移动。扁平外部数据设置 `applyRowDrag: false`，由 `onRowDragEnd` 处理持久化；自动模式先完成移动再发出事件，使用 `targetIndex` 读取最终下标。树、分组及排序等自动模式限制见[完整配方](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/row-presentation.md)。

文档：[快速开始](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/getting-started.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [API](https://github.com/ChenyCHENYU/MachTable/tree/main/docs/api)

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
