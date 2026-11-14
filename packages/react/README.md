<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table-react

MachTable 0.41.0 的官方 React 18+ 适配包。一个依赖即可获得 Core、泛型 `<MachTable>`、应用/路由配置、按需工作流、StrictMode 安全清理和最新闭包事件处理。

不传 `preset` 默认主列表 `list`；小明细只加 `preset="detail"`，保留序号、纯文字表头、默认只读、不分页，按内容收起，表体超过 330px 后虚拟滚动。无需先配置 Provider，主题与密度继续共享。

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
import { MachTable, type ColDef } from "@agile-team/mach-table-react";

interface Row { id: string; name: string }

export function Customers({ rows }: { rows: Row[] }) {
  const columns = useMemo<ColDef<Row>[]>(
    () => [{ field: "name", flex: 1, editable: true }],
    []
  );

  return (
    <div style={{ height: 520 }}>
      <MachTable<Row>
        rowData={rows}
        columnDefs={columns}
        rowKey="id"
      />
    </div>
  );
}
```

对象型列和配置建议用 `useMemo` 保持引用稳定。`useMachTable()` 同时提供 `apiRef`、响应式 `api` 与 `ready`。

默认 `list` 显示序号和内置分页，可通过 `rowNumber={false}`、`pagination={false}` 分别关闭。需要定制序号时直接声明 `indexColumn()`。

## 可选的应用配置

```ts
// src/config/mach-table.config.ts
import { createMachTablePreset, defineMachTableConfig } from "@agile-team/mach-table-react";

export default defineMachTableConfig({
  defaults: { theme: "auto", size: "compact", stripedRows: true },
  presets: {
    detail: createMachTablePreset("detail", { maxBodyHeight: 240 })
  }
});
```

```tsx
import { MachTableProvider } from "@agile-team/mach-table-react";
import machTableConfig from "@/config/mach-table.config";

<MachTableProvider config={machTableConfig}>
  <App />
</MachTableProvider>
```

直接使用组件即可获得默认场景；只有项目存在统一差异时才使用上面的 Provider。已有同名自定义 preset 完整优先，继承内置场景用 composer。Provider 可按路由/布局嵌套，最近一层覆盖外层，单表 props 优先级最高。

编辑、粘贴、清空和填充复用已有列与整行校验。`useMachTableEditing()` 隔离重挂载或数据替换前的保存结果、错误和冲突；查询工作流在 StrictMode 下保留 `immediate: false`，重复设置相同搜索值不会重新请求。

## 同页主表与明细

```tsx
<MachTable columnDefs={orderColumns} rowData={orders} rowKey="id" />
<MachTable preset="detail" columnDefs={materialColumns} rowData={basketA} rowKey="id" />
<MachTable preset="detail" columnDefs={materialColumns} rowData={basketB} rowKey="id" />
```

场景按用途选择，不根据数据行数猜测。`list` 默认表头工具和分页，`detail` 默认纯文字表头、只读、内容高度与 330px 表体上限，两者都保留序号。单列 `editable: true` 或表格 props 可覆盖差异；只读不承担权限校验。

全局 `defaultPreset: false` 或单表 `preset={false}` 可退出。切换会回退高度、分页和工具默认值，不额外清除业务排序、筛选或选择；改变列配置仍按既有生命周期重建编辑器，应先完成保存或放弃草稿。完整规则见[场景与配置](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/configuration.md)。

远程页删除后只需调用 `reload()`：当前页越界时最多补查一次最后有效页，不先发布中间空页。手动查询模式的条件变化会取消旧请求，仍等待显式提交。详见[远程查询](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/remote-query.md)。

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

<MachTable<Row> columnDefs={columns} {...query.bindings} />;
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

## 按需高级入口（0.34）

仍从本包导入，无需另装高级功能包。普通根入口不加载这些实现或附加 CSS。

| 子路径 | 功能 |
| --- | --- |
| `/workbench` | 高级过滤草稿与应用、修改差异/部分保存/冲突审阅、手动诊断 |
| `/preferences` | 复合身份隔离、CAS、有序写入、历史版本及列 ID/类型迁移报告 |
| `/ordering` | 多行/树移动、防环与业务约束、失败回滚、持久化撤销/重做 |
| `/server-side` | 服务端分组/聚合、route 分页、缓存/刷新/事务及层级选择 |
| `/multi-range` | Ctrl/Cmd 追加范围、格式化复制、校验清空及撤销 |
| `/import` | 有界数据预览、共享同步/异步校验、结构化错误与过期保护 |
| `/business` | 范围与币种/单位分组的本地语义合计 |
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

## 显示策略与本地合计

页面把已准备好的标签与普通格式化函数组合到列上。MachTable 只接收同步函数与普通选项，不持有字典实例、加载服务或订阅协议。异步数据准备与刷新由项目管理。

```ts
import { summarizeRows } from "@agile-team/mach-table-react/business";

const labels = new Map([["ready", "已就绪"]]);
const statusColumn = {
  field: "status",
  valueFormatter: ({ value }) => labels.get(String(value)) ?? String(value ?? ""),
  valueSerializer: ({ value, target }) =>
    target === "clipboard" ? labels.get(String(value)) ?? value : value
};
const rows = [{ currency: "CNY", unit: "t", amount: 120, completed: 2, planned: 4 }];
const summary = summarizeRows(rows, {
  scope: "page",
  groupBy: row => JSON.stringify([row.currency, row.unit]),
  metrics: [
    { id: "amount", kind: "sum", value: row => row.amount },
    { id: "count", kind: "count" },
    { id: "completion", kind: "ratio", numerator: row => row.completed, denominator: row => row.planned }
  ]
});
```

`/business` 只提供本地语义合计；scope 声明 page/selected/query，实际只处理传入记录。ratio 先汇总分子分母，精确金额可注入 numeric 策略；服务端全量由后端计算。详情见[业务列与合计](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/recipes/business-columns.md)。

## 列值与运行边界（自 0.33）

`ColDef.valueParser` 统一编辑、粘贴和导入的规范值；`valueSerializer` 按 clipboard/csv/xlsx 定义输出，沿用已有 `columnTypes` 优先级。排序/过滤读取规范值，可信事务与撤销不重复解析。`api.io.importMatrix()` / `exportMatrix()` 直传类型，完整导入预览从当前包的 `/import` 导入 `createImportPlan()`，不加载到默认入口。

`sum` / `avg` / `min` / `max` 只聚合有限数，空数值集合返回 null，sum/avg 溢出返回 null；`count` 计全部记录，空集合为 0。自定义聚合保留原始输入。分组 ID 区分数字/文本/空值，旧展开路径仅在唯一时迁移，歧义报告错误。超大远程滚动使用有界物理坐标，API、滚轮和交互共用逻辑偏移；应用默认配置的 `dataProcessor` 使用每表工厂。完整边界与升级说明见[升级指南](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/guide/upgrading.md)。


## 内容列宽与状态颜色（0.35）

未声明 `width` 的列默认按表头和已加载数据的显示文本测宽：每列均匀抽样最多 100 行，默认 80–360px，`minWidth/maxWidth` 可覆盖。长内容在单元格内省略，表格保留内部横向滚动；不为测宽请求远程数据或执行自定义渲染器。格式化文本及状态标签文字都参与测量。图形/操作等特殊列请指定宽度。

```ts
const columns = [
  { field: "customer", headerName: "客户", maxWidth: 280 },
  { field: "status", headerName: "状态", status: true },
  { field: "planStatus", headerName: "计划状态", status: {
    S1B: { label: "待复核", color: "danger" },
    S1C: { label: "已完成", color: "success" },
    special: { label: "特殊处理", color: "#8b5cf6" }
  } }
];
```

`status` 复用主题标签，支持 `success/warning/danger/info/neutral` 及 CSS 颜色；未知代码保持中性，`0/false` 保留。formatter 的文字可参与默认语义匹配；显式 renderer 优先。状态配置只控制展示，导出继续遵循原有列值政策。

默认 `columnLayout: "auto"`：自动业务列空间充足时按表头与内容基准比例铺满，列多时保留基准宽度并横向滚动；序号、多选和操作等结构列保持紧凑。显式 `normal` 保留按内容呈现，`fit` 保留整表比例分配。显式 `width` 和拖动后的宽度保持用户偏好；`autoWidth: false` 保留原默认 150px。显式选择 `columnLayout: "fit"` 时仍按首选宽度比例铺满，360px 限制的是内容首选宽度，实际铺满仍遵循显式 minWidth/maxWidth；配置 `flex` 则主动允许本列吸收余量。手动调宽只改变目标列，其他列保持当前宽度及自动模式；容器实际宽度、列结构或测量内容变化时再重新分配。列状态恢复及主动 `columns.fit()` 不受自动默认上限限制。更新数据或刷新单元格会重新测量，普通布局刷新复用结果。

表头默认完整展示，不省略。初始布局、fit、列宽恢复、API、鼠标和 Alt+方向键统一以完整标题及排序/筛选/列工具控件为最小宽度；显式 width/minWidth/maxWidth 不能把标题压窄，空间不足时表格内部横向滚动。360px 上限仅作用于数据内容的首选宽度，不截断表头。复杂自定义表头请显式提供 minWidth。

原生单元格按钮、链接、输入控件及 contenteditable 保留自身键盘和剪贴板行为；Enter/空格可直接激活详情等操作，Ctrl/Cmd 快捷键不会误触发表格编辑或修改表格数据。
