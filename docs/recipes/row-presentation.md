# 行拖拽与条件整行颜色

Core、Vue 和 React 使用相同的配置。两项能力独立启用，无需逐列写 renderer 或 CSS。

## 拖拽调整顺序

```ts
import { dragColumn, type GridOptions } from '@agile-team/mach-table'

const options: GridOptions<Plan> = {
  rowKey: 'id',
  columnDefs: [dragColumn(), { field: 'name' }, { field: 'status' }],
  onRowDragEnd: ({ api, applied, targetIndex }) => {
    if (!applied) return
    const ids: string[] = []
    api.rows.forEachDisplayed(node => { if (!node.isDetail) ids.push(node.id) })
    // 将 ids 交给应用的保存流程；targetIndex 是移动后的显示下标。
  }
}
```

`dragColumn()` 默认固定在左侧，宽度 40px。按住手柄移动超过 5px 后，来源行淡化，主题色落点线贯穿固定列与内容区，浮层显示起止位置。靠近表格上下边缘可自动滚动。Esc、窗口失焦、pointercancel、表格外释放和销毁均会取消并清理反馈。操作手柄不会选中行或触发单元格点击；聚焦手柄后可用 Alt + ↑/↓ 移动。

默认 `applyRowDrag: true` 只调整当前已显示的扁平本地数据。筛选和本地分页下可在当前显示范围内调整，未显示的数据保留相对顺序；展开的明细随主行移动。存在列排序、分组、树形、datasource 或 dataProcessor 时不允许自动重排，手柄禁用。清除列排序后恢复。不会修改传入数组或自动向后端写入。

服务端分页、datasource 或外部排序维护顺序时，设置 `applyRowDrag: false`，在 `onRowDragEnd` 保存业务顺序并重新提供 rowData。该模式只发出扁平行移动意图，`applied` 为 false；树形和分组仍禁用，避免隐式改变父子关系。随机加载的占位行不可拖动。拖动过程中显示行集合发生变化会取消此次移动。

`fromIndex` 是移动前显示下标，`targetIndex` 是移动后显示下标。保留的 `toIndex` 是历史插入边界（向下移动时通常比最终下标多 1），新接入请使用 `targetIndex`。自动模式先完成移动，再发出事件，回调中可读取最新顺序。直接调用 `api.rows.reorder(from, to)` 使用最终目标下标；无效输入或不支持的模式返回 false，不发出交互事件。

## 按条件配置整行颜色

```ts
const options: GridOptions<Plan> = {
  rowStyleRules: [
    { when: ({ data }) => data.status === 'S1B', tone: 'danger' },
    { when: ({ data }) => data.status === 'S1C', tone: 'success' },
    { when: ({ data }) => data.issued, tone: 'warning' }
  ]
}
```

上例的业务状态仅属于使用侧配置，包内不识别任何状态码。规则从上到下匹配，第一条命中生效；**未命中时保持表格原有样式**。条件应为无副作用的同步函数。可将严格条件放前面，例如已下达计划变为 S1B 后优先显示淡红色。

| 配置 | 含义 |
| --- | --- |
| `when({ data, node, api, rowPinned })` | 返回 true 时应用；rowPinned 为 top、bottom 或 null |
| `tone` | warning（淡黄）、danger（淡红）、success（淡绿）、info（淡蓝），随主题适配 |
| `backgroundColor` | 自定义 CSS 背景颜色，优先于 tone；可使用应用 CSS 变量 |
| `color` | 可选文字颜色，默认沿用主题正文色 |

自定义示例：`{ when: ({ data }) => data.urgent, backgroundColor: 'var(--app-urgent-bg)', color: 'var(--app-urgent-fg)' }`。也可覆盖 `--mach-row-warning-bg`、`--mach-row-danger-bg`、`--mach-row-success-bg`、`--mach-row-info-bg` 统一调整语义色。

颜色覆盖整行所有固定/滚动列和已加载的树节点；悬停、选择时叠加主题色，保留状态底色及焦点边框。单元格显式配置的内联 cellStyle 仍可覆盖该单元格。规则默认也应用于置顶/置底数据行，条件中可使用 `rowPinned === null` 限制为普通行。分组、明细和加载占位行不参与匹配。

编辑、事务更新、行数据替换和虚拟滚动时会重算颜色；DOM 复用不会残留上条记录颜色。外部直接修改数据后，调用 `api.view.refreshCells({ rowIds: [...] })`。运行时可用 `api.updateOptions({ rowStyleRules: [...] })` 替换规则，传 `[]` 或 `undefined` 清空。Vue/React 对应属性遵循同一更新机制。条件异常会记录诊断并继续检查后续规则，不中断表格渲染。
