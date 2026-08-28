# 路线图与差距分析

对照 AG Grid（社区/企业版）、TanStack Table、Handsontable、vxe-table 的公开能力矩阵，审视 MachTable v0.4.1 的差距与打磨方向。

## 能力差距（按优先级）

### P0 —— 高价值、低成本

| 能力 | 现状 | 方案 | 对标 |
| --- | --- | --- | --- |
| ~~内容驱动行高自动测量~~ | ✅ v0.3 `autoHeight`（canvas 测量 + 行高缓存） | — | AG autoHeight |
| ~~colSpan 列合并~~ | ✅ v0.3 `colSpan` 回调（覆盖隐藏 + 宽度延伸） | — | AG / Handsontable |
| ~~右键菜单自定义项~~ | ✅ v0.3 `getContextMenuItems`（separator/danger/disabled） | — | AG |
| ~~单元格变更闪烁反馈~~ | ✅ v0.3 `flashCells`（编辑/粘贴/填充/撤销统一） | — | AG flashCells |
| ~~富 tooltip 组件~~ | ✅ v0.3 `tooltipComponent` + `tooltipShowDelay` | — | AG tooltip |
| ~~表头键盘可达~~ | ✅ 表头 Tab 可聚焦，Enter/Space 循环排序、Alt+←→ 调宽 24px、Ctrl+←→ 移列 | a11y / AG |
| ~~dev 模式配置校验~~ | ✅ 内容签名去重告警（重复 colId/缺字段值来源/宽高冲突），`suppressWarnings` 静默 | 各库惯例 |

### P1 —— 中成本

| 能力 | 说明 | 对标 |
| --- | --- | --- |
| 列分组拖拽（整组移动） | 目前仅叶子列在同分组/同窗格内移动 | AG |
| 填充柄横向 + 固定列边界 | 目前仅纵向、范围末端须在中窗格 | AG / Excel |
| 行拖拽跨层级（树形 DnD） | 树形下拖拽仅发事件不自动应用 | AG / vxe |
| ~~富 tooltip 组件~~ | ✅ v0.3 已实现（tooltipComponent） | AG tooltip component |
| 空态骨架屏 | loading spinner → 可选骨架行 | EP/Naive 惯例 |
| 双击行/单元格边框自适应 | 已有（双击调宽把手）→ 补双击表头分隔任意位置 | AG |
| cellRenderer 框架上下文共享 | 适配器独立 app，不继承 ConfigProvider | 改 `render(vnode, host)` + `appContext` 注入 |
| 导出 xlsx（前端多 Sheet） | CSV 已有 | SheetJS 可选依赖（不进内核） |

### P2 —— 大成本 / 依赖场景

| 能力 | 说明 | 对标 |
| --- | --- | --- |
| 服务端行模型（SSRM） | 行分组/聚合下推服务端 | AG 企业版 |
| Pivot 透视模式 | 列转轴 | AG 企业版 / VTable |
| Canvas 渲染引擎 | 超大只读场景（当前 DOM 天花板 ~50 万单元格流畅） | VTable / AG 企业 |
| 范围选跨网格（拖出/入） | 拖拽 DnD 协议 | AG |
| 协同编辑（OT/CRDT） | — | Excel 类 |

## 性能打磨方向

| 项 | 现状 | 目标 |
| --- | --- | --- |
| 列虚拟化窗口平移 | display 切换（隐藏保留 DOM） | 大表可选"滑动窗口重建"模式权衡 |
| 排序大表 | 主线程（10 万行 ~150ms） | >5 万行可选 Worker 排序 |
| 首帧 | 同步全管线 | 分帧渲染（先视口后 buffer） |
| 内存 | 行池 + span 缓冲复用 | 长会话 heap 剖析建立基线 |

## 交互打磨清单

- 触屏：长按 = 右键菜单、拖拽手柄 `touch-action: none`（已具备）、双指滚动手势确认
- 滚动条快速拖动中段的占位行（骨架行而非空白）
- 编辑 Enter 后焦点去留可配置（AG 有 stopEditingAfterEnter 类开关）
- 行 hover 与选中的视觉层级在暗色主题下再校准一轮

## 视觉打磨清单

- 状态栏/合计行在 `large` 密度下的间距节奏
- 过滤面板/列面板入出场动画（transform + opacity，120ms）
- 深浅主题对比度过 WCAG AA 复核（当前主色对比度 4.5:1 达标，弱色底需复核）
- 更多预设主题（Follow EP 亮暗 12 色系列 / Naive 亮暗）

## 可维护性 / 工程化

| 项 | 现状 | 计划 |
| --- | --- | --- |
| E2E | 无 | Playwright 冒烟（滚动/编辑/框选/导出） |
| 视觉回归 | 无 | Playwright screenshot 对三密度×两主题 |
| 包规范 | exports map 完整 | CI 加 publint / attw 校验 |
| API 文档自动化 | 手写 | api-extractor 从 d.ts 生成对照，防漂移 |
| 基准测试 | 手测 | codspeed/criterion 跑 1k/10k/100k 基线，PR 可见 |
| 错误边界 | cellRenderer/detailRenderer/headerComponent 已 try/catch | 补 cellClass/cellStyle 回调守卫 |

## 结论

v0.4.1 已覆盖 AG 社区版主要能力与企业版核心高频面（范围操作/分组/树/明细/固定行/变高/无限）。剩余差距集中在：**P0 六项**（多为体验补齐）、**SSRM/Pivot/Canvas** 三大件（按业务需要立项）。建议节奏：P0 → E2E+视觉回归 → P1 按场景取用。
