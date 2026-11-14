<p align="center">
  <img src="https://raw.githubusercontent.com/ChenyCHENYU/MachTable/main/assets/mach-table-logo.svg" alt="MachTable" width="760" />
</p>

# @agile-team/mach-table

MachTable 0.41.1 的框架无关 TypeScript Core，零运行时依赖。提供行列双虚拟化、编辑、树与分组、随机访问远程数据和区段隔离状态持久化。裸 `createGrid()` 保留原有低层默认值：分页开启，序号按 `rowNumber: true` 启用。通过 `createMachTablePreset("list" | "detail", options)` 可显式使用与适配器一致的场景。

`list` 提供序号、列筛选、列设置与列宽调整；`detail` 保留序号、默认只读和纯文字表头，关闭分页并按内容收起，表体超过 330px 后使用虚拟滚动。表内筛选无匹配时，默认空态提供清除筛选；业务自定义空态优先。

跨行合并适合有界小跨度，当前应将 `rowBuffer` 配置为不小于最大合并行数。超过缓冲的大跨度尚未提供跨窗口锚点保留；边界与配置见[列定义](https://github.com/ChenyCHENYU/MachTable/blob/main/docs/api/col-def.md)。

```bash
pnpm add @agile-team/mach-table
```

```ts
import { createGrid, createMachTablePreset } from "@agile-team/mach-table";
import "@agile-team/mach-table/styles/mach-table.css";

const api = createGrid(document.querySelector("#grid")!, createMachTablePreset("list", {
  columnDefs: [
    { field: "id", headerName: "ID", width: 120 },
    { field: "name", headerName: "名称", flex: 1, editable: true }
  ],
  rowData: [{ id: "1", name: "MachTable" }],
  rowKey: "id",
  persistence: { key: "tenant:user:customers", sections: ["columns"] }
}));

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

场景不根据行数猜测，主题和密度独立配置。`createMachTablePreset("detail", { maxBodyHeight: 240 })` 可只改统一差异；业务列仍可显式 `editable: true`，单表 `rowNumber: false` 可关闭序号。只读默认不是权限校验。Vue/React 默认选择 `list`，裸 Core 不会自动选择场景。

`persistence.sections` 同时约束进入 store 的数据与恢复范围；异步 store 写入有序，晚到加载不会覆盖加载期间的用户操作。

单元格编辑通过内置对勾/取消控件显式结束，普通鼠标和焦点变化不会误提交；Enter、Escape、Tab 仍提供完整键盘路径。筛选、列设置、上下文菜单和操作菜单会继承所属表格实例的主题变量，不受宿主页面全局样式影响。

编辑、粘贴、清空和填充共用已有列校验与整行校验，批量输入按行提交并合并撤销记录，异步校验不会写回已替换的数据。随机块缓存淘汰后，未保存行仍可通过编辑 API 保存或回滚；完整替换数据与重新查询会清理旧作用域的状态。

`loading: true` 默认展示主题色数据条的小型错峰动效与本地化文案，减少动画设置下静止展示；空数据使用内置插画。需要品牌化时再通过 `overlayLoadingTemplate`、`overlayNoRowsTemplate` 覆盖，基础页面无需重复实现 loading/empty DOM。

内置空态使用适配亮暗主题的淡蓝表格卡片与放大镜插画；`locale.emptyRows` 和 `locale.emptyRowsHint` 分别配置标题、说明，均按纯文本呈现。静态 SVG 不依赖远端资源或共享 id，多表并排不会互相影响。

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
import { mountAdvancedFilterBuilder } from "@agile-team/mach-table/workbench";
import "@agile-team/mach-table/styles/workbench.css";

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
import { summarizeRows } from "@agile-team/mach-table/business";

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

冻结区由正文视口统一管理滚动，原生焦点恢复和 `scrollIntoView` 不会单独改变其滚动位置。业务定位继续使用 `api.view.scrollToRow()`，无需页面补丁。


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

默认 `columnLayout: "auto"`：自动业务列空间充足时按表头与内容基准比例铺满，列多时保留基准宽度并横向滚动；序号、多选和操作等结构列保持紧凑。显式 `normal` 保留按内容呈现，`fit` 保留整表比例分配。显式 `width` 和拖动后的宽度保持用户偏好；`autoWidth: false` 保留原默认 150px。显式选择 `columnLayout: "fit"` 时仍按首选宽度比例铺满，360px 限制的是内容首选宽度，实际铺满仍遵循显式 minWidth/maxWidth；配置 `flex` 则主动允许本列吸收余量。手动调宽只改变目标列，其他列保持当前宽度及自动模式；纯文本缩窄后保留开头并在尾部省略，完整内容可通过提示查看，行背景持续覆盖中心可用区；容器实际宽度、列结构或测量内容变化时再重新分配。列状态恢复及主动 `columns.fit()` 不受自动默认上限限制。更新数据或刷新单元格会重新测量，普通布局刷新复用结果。

表头默认完整展示，不省略。初始布局、fit、列宽恢复、API、鼠标和 Alt+方向键统一以完整标题及排序/筛选/列工具控件为最小宽度；显式 width/minWidth/maxWidth 不能把标题压窄，空间不足时表格内部横向滚动。360px 上限仅作用于数据内容的首选宽度，不截断表头。复杂自定义表头请显式提供 minWidth。

原生单元格按钮、链接、输入控件及 contenteditable 保留自身键盘和剪贴板行为；Enter/空格可直接激活详情等操作，Ctrl/Cmd 快捷键不会误触发表格编辑或修改表格数据。
