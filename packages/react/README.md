<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-react

MachTable 0.33.0 的官方 React 18+ 适配包。一个依赖即可获得 Core、泛型 `<MachTable>`、应用/路由配置、按需工作流、StrictMode 安全清理和最新闭包事件处理。

```bash
pnpm add @agile-team/mach-table-react
```

应用入口只引入一次样式：

```ts
import "@agile-team/mach-table-react/styles.css";
```

## 基础接入

```tsx
import { useMemo } from "react";
import { MachTable, indexColumn, useMachTable, type ColDef } from "@agile-team/mach-table-react";

interface Row { id: string; name: string }

export function Customers({ rows }: { rows: Row[] }) {
  const table = useMachTable<Row>();
  const columns = useMemo<ColDef<Row>[]>(
    () => [indexColumn({ headerName: "序号" }), { field: "name", flex: 1, editable: true }],
    []
  );

  return (
    <div style={{ height: 520 }}>
      <MachTable<Row>
        apiRef={table.apiRef}
        rowData={rows}
        columnDefs={columns}
        rowKey="id"
        enableColumnResize
        persistence={{ key: "customers:list", sections: ["columns"] }}
      />
    </div>
  );
}
```

对象型列和配置建议用 `useMemo` 保持引用稳定。`useMachTable()` 同时提供 `apiRef`、响应式 `api` 与 `ready`。

## 应用配置

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-react";

export default defineMachTableConfig({
  defaults: {
    size: "compact",
    columnLayout: "fit",
    enableColumnResize: true,
    defaultColDef: { sortable: true, filter: true, resizable: true }
  },
  defaultPreset: "list",
  presets: {
    list: defineMachTablePreset({ stripedRows: true }),
    crud: defineMachTablePreset({ rowSelection: "multiple", editType: "fullRow" })
  }
});
```

```tsx
<MachTableProvider config={machTableConfig}>
  <App />
</MachTableProvider>
```

Provider 可按路由/布局嵌套，最近一层覆盖外层，表格 props 优先级最高。

编辑、粘贴、清空和填充复用已有列与整行校验。`useMachTableEditing()` 隔离重挂载或数据替换前的保存结果、错误和冲突；查询工作流在 StrictMode 下保留 `immediate: false`，重复设置相同搜索值不会重新请求。

## 按需加载

React 不模拟全局组件注册。路由本身懒加载时普通 import 已自然拆包；需要独立边界时：

```tsx
const MachTable = lazy(() => import("@agile-team/mach-table-react"));
```

可选能力使用子入口：

```tsx
import { useMachTableQuery, useMachTableEditing } from "@agile-team/mach-table-react/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-react/ui";
import { reactCellRenderer } from "@agile-team/mach-table-react/adapters";
import { createWorkerDataProcessor } from "@agile-team/mach-table-react/worker";
```

- `/workflows`：请求取消、防过期覆盖、服务端分页、跨页选择、脏数据和冲突保存；`reset()` 清空全部表格过滤且只请求一次。
- `/ui`：可选标准工具栏。
- `/adapters`：自定义 React cell/detail renderer 桥接。
- `/worker`：大型本地过滤/排序的独立 Worker 能力。

```tsx
const query = useMachTableQuery({
  query: filters,
  queryKey: filters,
  rowKey: "id",
  request: orderApi.page,
  mode: "manual"
});

<MachTable<Row> apiRef={table.apiRef} columnDefs={columns} {...query.bindings} />;
```

该包自动依赖 `@agile-team/mach-table` 并重导出 Core 类型；宿主只需提供 `react` 和 `react-dom >= 18`。

## 行拖拽与条件整行颜色

```ts
import { dragColumn, type GridOptions } from "@agile-team/mach-table-react";

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

文档：[React 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/react.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [SSR](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/ssr.md)

## 按需高级入口（0.33）

仍从本包导入，无需另装高级功能包。普通根入口不加载这些实现或附加 CSS。

| 子路径 | 功能 |
| --- | --- |
| `/workbench` | 高级过滤草稿与应用、修改差异/部分保存/冲突审阅、手动诊断 |
| `/preferences` | 复合身份隔离、CAS、有序写入、历史版本及列 ID/类型迁移报告 |
| `/ordering` | 多行/树移动、防环与业务约束、失败回滚、持久化撤销/重做 |
| `/server-side` | 服务端分组/聚合、route 分页、缓存/刷新/事务及层级选择 |
| `/multi-range` | Ctrl/Cmd 追加范围、格式化复制、校验清空及撤销 |
| `/import` | 有界数据预览、共享同步/异步校验、结构化错误与过期保护 |
| `/analysis` | Pivot、安全公式、柱/折线图和数据表回退 |

```ts
import { mountAdvancedFilterBuilder } from "@agile-team/mach-table-react/workbench";
import "@agile-team/mach-table-react/styles/workbench.css";

const filters = mountAdvancedFilterBuilder(host, { api });
// 宿主卸载时调用；表格销毁也会释放工作台。
filters.destroy();
```

服务端分组控件使用 `/styles/server-side.css`，分析与多范围使用 `/styles/workbench.css`。排序、偏好和纯分析计算无需附加 CSS。服务端 Store 按 route 分页，不提供全树任意显示 offset；分析只处理当前已加载数据并显示范围。排序 undo/redo 的 transport 必须一次 CAS 保存 `context.operations` 的完整批次或 `context.plan.after`，只保存首参数无法完整恢复非连续/跨父级位置。

完整示例与限制：[工作台](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/workbench.md) · [排序](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/row-presentation.md) · [企业偏好](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/enterprise-preferences.md) · [服务端 Store](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/server-side-store.md) · [多范围](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/multi-range.md) · [分析](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/analysis.md)。

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。

## 0.33 列值与运行边界

`ColDef.valueParser` 统一编辑、粘贴和导入的规范值；`valueSerializer` 按 clipboard/csv/xlsx 定义输出，沿用已有 `columnTypes` 优先级。排序/过滤读取规范值，可信事务与撤销不重复解析。`api.io.importMatrix()` / `exportMatrix()` 直传类型，完整导入预览从当前包的 `/import` 导入 `createImportPlan()`，不加载到默认入口。

`sum` / `avg` / `min` / `max` 只聚合有限数，空数值集合返回 null，sum/avg 溢出返回 null；`count` 计全部记录，空集合为 0。自定义聚合保留原始输入。分组 ID 区分数字/文本/空值，旧展开路径仅在唯一时迁移，歧义报告错误。超大远程滚动使用有界物理坐标，API、滚轮和交互共用逻辑偏移；应用默认配置的 `dataProcessor` 使用每表工厂。完整边界与升级说明见[升级指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/upgrading.md)。
