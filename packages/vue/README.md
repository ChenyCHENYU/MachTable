<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-vue

MachTable 0.32.1 的官方 Vue 3 适配包。一个依赖即可获得 Core、泛型 `<MachTable>`、原生 slots、应用/路由配置、按需工作流、异步组件边界和自动生命周期清理。

按 key 切换表格场景时，`useMachTable()` / `useMachTableController()` 会重新绑定当前实例并等待其就绪。模板中的行拖拽事件使用 `@row-drag-end="handleRowDragEnd"`，也可在 `v-bind` 配置对象中传入 `onRowDragEnd`。

```bash
pnpm add @agile-team/mach-table-vue
```

应用入口只引入一次样式：

```ts
import "@agile-team/mach-table-vue/styles.css";
```

## 局部接入

```vue
<script setup lang="ts">
import { h, ref } from "vue";
import {
  MachTable,
  defineVueColumns,
  defineVueTableConfig,
  indexColumn,
  useMachTable,
} from "@agile-team/mach-table-vue";

interface Row { id: string; name: string; status: "enabled" | "disabled" }
const table = useMachTable<Row>();
const rows = ref<Row[]>([{ id: "1", name: "MachTable", status: "enabled" }]);
const columns = defineVueColumns<Row>([
  indexColumn({ headerName: "序号" }),
  { field: "name", flex: 1, editable: true },
  {
    field: "status",
    headerName: "状态",
    render: (row) => h("span", { class: `status-${row.status}` }, row.status === "enabled" ? "启用" : "停用")
  }
]);
const tableConfig = defineVueTableConfig<Row>({
  rowKey: "id",
  enableColumnResize: true,
  stripedRows: true,
  persistence: { key: "customers:list", sections: ["columns"] }
});
</script>

<template>
  <div style="height: 520px">
    <MachTable
      v-bind="tableConfig"
      :ref="table.ref"
      :row-data="rows"
      :column-defs="columns"
    />
  </div>
</template>
```

业务列优先用 `defineVueColumns()` 的 `render(row, index, params)` 返回 VNode；它保留 Vue 应用上下文、支持原位刷新，并遵循全局、表格和单列对齐配置。复杂页面编排仍可使用 `#cell-*` 具名插槽，具名插槽会显式覆盖同列 `render`。多个稳定表格参数推荐放进页面 `data.ts` 或共享配置模块，模板通过一次 `v-bind="tableConfig"` 注入；`rowData`、`columnDefs` 和实例 `ref` 保持显式，便于看清数据来源。

未声明 `#loading` / `#empty` 时会直接使用 Core 的紧凑骨架加载态与插画空态；只有产品确实需要品牌化呈现时才提供 slot，避免每个页面重复维护同类状态组件。

单元格编辑在用户点击对勾/取消或执行 Enter、Escape、Tab 键盘命令前保持挂载，焦点变化和中文输入法组合输入不会提前提交。整行事务请设置 `edit-type="fullRow"` 并增加 `rowActionsColumn()`，该操作列会自动切换编辑、保存和取消状态。

粘贴、清空和填充会复用相同的列与整行校验配置。`useMachTableEditing()` 将保存结果与提交时的实例和行数据关联，重挂载或替换数据后，旧请求的结果、错误与冲突不会影响新记录。

## 全局接入

表格页面较多时，全局注册一次，页面模板直接使用 `<MachTable>`：

```ts
import { createApp } from "vue";
import { MachTablePlugin } from "@agile-team/mach-table-vue";
import machTableConfig from "@/config/mach-table.config";

createApp(App).use(MachTablePlugin, machTableConfig).mount("#app");
```

需要减少首屏代码时改用异步全局插件：

```ts
import AsyncMachTablePlugin, { preloadMachTable } from "@agile-team/mach-table-vue/async";

app.use(AsyncMachTablePlugin, machTableConfig);
void preloadMachTable(); // 可选：路由 hover 时预取
```

推荐把约定集中到独立文件：

```ts
// src/config/mach-table.config.ts
import { defineMachTableConfig, defineMachTablePreset } from "@agile-team/mach-table-vue";

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

布局或路由可用响应式 `provideMachTableConfig()` 叠加配置，表格 props 始终拥有最高优先级。

## 按需子入口

```ts
import { useMachTableQuery, useMachTableEditing } from "@agile-team/mach-table-vue/workflows";
import { MachTableToolbar } from "@agile-team/mach-table-vue/ui";
import { vueCellRenderer } from "@agile-team/mach-table-vue/adapters";
import { createElementPlusEditors } from "@agile-team/mach-table-vue/editors";
import { createWorkerDataProcessor } from "@agile-team/mach-table-vue/worker";
```

- `/workflows`：请求取消、防过期覆盖、服务端分页、跨页选择、脏数据和冲突保存；`reset()` 清空全部表格过滤且只请求一次。
- `/ui`：可选标准工具栏；需要全局组件时另行 `app.use(MachTableUiPlugin)`，其全局组件类型也只在导入该子入口后生效。
- `/adapters`：自定义 Vue renderer/editor/detail/overlay 桥接。
- `/editors`：可选 Element Plus 编辑器，Element Plus 由宿主注入。
- `/worker`：大型本地过滤/排序的独立 Worker 能力。

该包自动依赖 `@agile-team/mach-table` 并重导出 Core 类型；宿主只需提供 `vue >= 3.2`。

## 行拖拽与条件整行颜色

```ts
import { dragColumn, type GridOptions } from "@agile-team/mach-table-vue";

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

文档：[Vue 指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/vue.md) · [企业接入](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/enterprise-integration.md) · [配置中心](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/configuration.md)

## 按需高级入口（0.32）

仍从本包导入，无需另装高级功能包。普通根入口不加载这些实现或附加 CSS。

| 子路径 | 功能 |
| --- | --- |
| `/workbench` | 高级过滤草稿与应用、修改差异/部分保存/冲突审阅、手动诊断 |
| `/preferences` | 复合身份隔离、CAS、有序写入、历史版本及列 ID/类型迁移报告 |
| `/ordering` | 多行/树移动、防环与业务约束、失败回滚、持久化撤销/重做 |
| `/server-side` | 服务端分组/聚合、route 分页、缓存/刷新/事务及层级选择 |
| `/multi-range` | Ctrl/Cmd 追加范围、格式化复制、校验清空及撤销 |
| `/analysis` | Pivot、安全公式、柱/折线图和数据表回退 |

```ts
import { mountAdvancedFilterBuilder } from "@agile-team/mach-table-vue/workbench";
import "@agile-team/mach-table-vue/styles/workbench.css";

const filters = mountAdvancedFilterBuilder(host, { api });
// 宿主卸载时调用；表格销毁也会释放工作台。
filters.destroy();
```

服务端分组控件使用 `/styles/server-side.css`，分析与多范围使用 `/styles/workbench.css`。排序、偏好和纯分析计算无需附加 CSS。服务端 Store 按 route 分页，不提供全树任意显示 offset；分析只处理当前已加载数据并显示范围。排序 undo/redo 的 transport 必须一次 CAS 保存 `context.operations` 的完整批次或 `context.plan.after`，只保存首参数无法完整恢复非连续/跨父级位置。

完整示例与限制：[工作台](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/workbench.md) · [排序](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/row-presentation.md) · [企业偏好](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/enterprise-preferences.md) · [服务端 Store](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/server-side-store.md) · [多范围](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/multi-range.md) · [分析](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/analysis.md)。

Source-available © ChenyCHENYU (Agile Team). 任何使用均须事先取得书面授权。详见 [LICENSE](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSE) 与[授权流程](https://github.com/ChenyCHENYU/MachTable/blob/main/LICENSING.md)。
