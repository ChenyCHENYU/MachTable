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

服务端分页、datasource 或外部排序维护顺序时，设置 `applyRowDrag: false`，在 `onRowDragEnd` 保存业务顺序并重新提供 rowData。未安装额外策略时，该模式只发出单条扁平行移动意图，`applied` 为 false；树形仍禁用。下方可选 `/ordering` 控制器提供显式的多行和树形策略，分组行仍不可拖动。随机加载的占位行不可拖动。拖动过程中显示行集合发生变化会取消此次移动。

`fromIndex` 是移动前显示下标，`targetIndex` 是移动后显示下标。保留的 `toIndex` 是历史插入边界（向下移动时通常比最终下标多 1），新接入请使用 `targetIndex`。自动模式先完成移动，再发出事件，回调中可读取最新顺序。直接调用 `api.rows.reorder(from, to)` 使用最终目标下标；无效输入或不支持的模式返回 false，不发出交互事件。

## 可选业务排序：多行、树形与保存

需要权限、跨父级移动或服务端版本保存时，使用可选 `/ordering`。控制器把手柄交互转换成稳定 ID 意图，业务侧只提供数据归属和一个保存函数：

```ts
import { createGrid, dragColumn, selectionColumn, type GridApi } from '@agile-team/mach-table';
import { createRowOrderController } from '@agile-team/mach-table/ordering';

interface Task { id: string; title: string; locked?: boolean; children?: Task[] }
let rows: readonly Task[] = initialRows;
let api: GridApi<Task> | null = null;
let revision: string | number = initialRevision;

const ordering = createRowOrderController<Task>({
  rowKey: 'id',
  treeData: true,
  getRows: () => rows,
  applyRows: next => {
    rows = next;
    api?.rows.setData([...next]);
  },
  getRevision: () => revision,
  canMove: ({ row, parent }) =>
    row.locked ? '该任务已锁定' : parent?.locked ? '目标父项已锁定' : true,
  save: (_intent, { signal, operations, operation, plan }) =>
    taskApi.saveOrder({
      // 最简单的协议：在一次 CAS 中原子安装完整排序结果。
      expectedRevision: operations[0].expectedRevision,
      operation,
      rows: plan.after
    }, { signal })
});

api = createGrid<Task>(host, {
  ...ordering.bindings,
  rowKey: 'id', rowData: [...rows], treeData: true,
  rowSelection: 'multiple', autoCheckedChildren: false,
  columnDefs: [dragColumn(), selectionColumn(), { field: 'title' }]
});
const unsubscribe = ordering.subscribe(state => {
  if (state.status === 'saved' && state.revision !== undefined) revision = state.revision;
  showOrderStatus(state); // idle / saving / saved / error / conflict
});
api.on('gridDestroyed', () => { unsubscribe(); ordering.dispose(); });
```

上例 `taskApi` 和状态提示由宿主实现。后端选择按序应用整批 `operations` 或原子安装完整 `plan.after`，两种协议只执行一种。`save` 返回 `void` 或 `{ revision }` 表示成功；返回 `{ status: 'conflict', revision, message }` 或抛出 `RowOrderConflictError` 表示版本冲突。控制器一次只允许一个保存，手柄在提交中暂时禁用；宿主应展示 `state.status/error`，避免保存失败只有控制台反馈。不要在保存尚未确认时推进 `getRevision()` 的值。

Vue / React 使用同一协议，从 `@agile-team/mach-table-vue/ordering` 或 `@agile-team/mach-table-react/ordering` 导入，表格与 `dragColumn/selectionColumn` 仍从相同适配包主入口导入。控制器在组件生命周期中创建一次，`bindings` 合入表格配置；需要自己的 `onRowDragEnd` 时应显式组合调用，不能覆盖控制器绑定。排序样式沿用正常表格主题，无需额外 CSS。

拖动已选行会移动当前模型中可取得的选中项，拖动未选行只移动该项；所选项按源模型顺序移动，与勾选先后无关。树形父子同时选中时只搬运父项一次，整棵子树随行；禁止移入自身或后代，支持跨父级移动与 `canMove` 父级限制。树目标上部/中部/下部分别是 before / inside / after，inside 追加到目标的直接子项末尾。手柄 Alt + ↑/↓ 在同级目标间移动；跨父级操作使用指针或明确的 `move()` 意图。

提交意图含 `rowIds`、`targetId`、`position`、可选 `expectedRevision`，以及计算后的相邻 `beforeId/afterId`。宿主保存这些稳定 ID，不保存显示下标或客户端推算的浮点 rank；服务端仍需校验权限、版本、防环及完整兄弟顺序。前端约束不代替后端权限检查。

`getRows()` 必须返回宿主持有的完整排序作用域，`applyRows()` 安装不可变结果；树默认读取直接 `children` 属性，自定义时同时配置控制器与表格的 `childrenKey`。不要传入循环/共享节点、重复或空行 ID。排序会保留未修改分支的引用，不修改原数组。

默认托管拖拽仅调整当前显示范围；可选控制器按宿主提供的完整源模型生成计划，因此筛选或分页下的相邻 ID 也来自这份模型。服务器只给出当前页时，客户端无法推断未加载页的全局边界；跨页位置需由服务器协议确定。存在列排序时业务顺序可能被显示排序覆盖，建议顺序维护页面关闭列排序，或在产品中明确两者关系。服务端分组 Store、随机占位行和自动分组不是本控制器的树形源模型。

控制器先安装本地顺序，再保存。失败/冲突时，仅当当前模型、版本和实例仍属于这次移动且没有新编辑时才恢复 `plan.before`；如果期间宿主换数、换版本、销毁或产生未保存编辑，则不覆盖新工作。绑定的手柄会阻止编辑中和 dirty 状态发起排序；宿主的 `applyRows` 也应拒绝会丢失业务草稿的数据替换。`dispose()` 发出 AbortSignal，使尚未结束的 `move()` / `undo()` / `redo()` 及时以 `AbortError` 拒绝。即使 transport 忽略 signal，调用方也不会继续等待；底层传输仍可能继续，但晚到结果不能再更新控制器，取消也不能撤销服务器已经完成的写入。

需要自定义按钮时可用 `ordering.preview(intent)` 检查计划，或 `await ordering.move(intent)` 执行。独立函数 `reorderRows()` / `moveTreeNodes()` 返回 `{ before, after, intent, rowIds, changed }`，只计算、不保存。

### 业务顺序撤销与重做

```ts
if (ordering.state.canUndo) await ordering.undo();
if (ordering.state.canRedo) await ordering.redo();
```

控制器保留最多 50 项排序历史，移动、撤销和重做均使用同一个 `save` 处理器。`context.operation` 为 `move` / `undo` / `redo`；每次只调用一次 `save`，保存成功后才移动历史游标。撤销或重做也携带当前预期版本，发生冲突或失败时会尽可能补偿本次乐观顺序，保留此前历史位置。保存中、存在活动编辑或 dirty 时拒绝新操作。

非连续多行或跨父级撤销可能需要多条 `context.operations` 才能恢复原位；这些意图共享同一个 `expectedRevision`，必须由服务端在单次 CAS 和事务中按序执行。为兼容旧处理器保留的首参 `intent` 只是 `operations[0]`，只保存它不能正确处理复杂撤销。宿主也可以采用更简单的协议：一次 CAS 原子保存 `context.plan.after` 的完整结果。

新移动成功会截断 redo 分支。更换实例、外部模型/节点/版本替换或字段编辑会清理不再属于当前数据的历史；保存期间发生新字段编辑也不会把旧树父节点克隆重新纳入历史。历史只表示当前会话内的排序操作，独立于 `api.editing.undo()/redo()` 的单元格变更栈。服务器已成功提交的排序不能靠本地恢复 `plan.before` 撤销，必须走带最新版本的新保存。

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
