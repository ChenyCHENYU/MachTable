# 架构说明

## 分层

```
┌──────────────────────────────────────────────────┐
│ 框架适配层   @agile-team/mach-table-vue（优先）· react（官方）│
│             props ↔ options 桥接 · 组件适配器     │
├──────────────────────────────────────────────────┤
│ 命令层       8 个领域 API · 0.x 平面兼容层       │
├──────────────────────────────────────────────────┤
│ 服务层       columnModel · rowModel（数据管道）   │
│             selection · editing · undoRedo       │
│             keyboard · resize · columnDrag       │
│             filterPopup · columnMenu · ctxMenu   │
├──────────────────────────────────────────────────┤
│ 渲染层       skeleton（三窗格骨架）               │
│             headerRenderer · bodyRenderer        │
│             pinnedRows · summary · statusBar     │
├──────────────────────────────────────────────────┤
│ 基础设施     EventBus · option/feature governance │
│             state migration · performance monitor │
│             lib/（纯函数库）· 主题 CSS             │
└──────────────────────────────────────────────────┘
```

## 目录

```
packages/core/src/
├── types/            # 公共类型单一事实源（options/colDef/events/api/params/row）
├── core/             # GridCore 编排器 · createGrid · typed EventBus · option metadata
├── services/         # 模型服务 + 编辑、菜单、提示等 UI 交互服务
│   ├── column / columnGroup / columnModel
│   ├── rowModel（行管道：过滤→排序→分组/树/明细/无限→序号→合并）
│   ├── selection / editing / editors / undoRedo
│   ├── rangeSelectionModel（纯状态，不持有 DOM）
│   └── keyboard / resize / columnDrag / filterPopup / columnMenu / contextMenu
├── render/           # DOM 渲染（薄，状态来自服务层）
│   ├── skeleton（三窗格 + ResizeObserver + 覆盖层）
│   ├── headerRenderer / bodyRenderer（虚拟滚动）
│   ├── pinnedRowsRenderer / summaryRenderer / statusBarService
│   └── cellContent（单元格内容/类名/样式，写前去重）
├── lib/              # 纯函数：compare/path/layout/csv/tsv/aggregate/
│                     #        clipboard/schema/locale/registry/columnStateStore
└── __tests__/        # Vitest：纯函数单测 + jsdom 渲染管线集成测试
```

## 数据流（单向）

```
用户交互 / api 调用
      ↓
服务层计算（列模型/行管道/选择/撤销栈）
      ↓
GridCore.emit ——→ EventBus + options.onXxx（双通道广播）
      ↓
渲染层按需增量刷新（行池 diff / 单格刷新 / 弹层）
```

关键约束：

- **模型与 UI 职责分离**：columnModel/rowModel/selection 等不持有 DOM；编辑、菜单、提示、拖拽服务负责受控的临时 DOM 与监听器生命周期
- **写值单一入口** `GridCore.setCellValue`：编辑/粘贴/填充/剪切/清除/撤销统一走它（保证事件、撤销栈、视图刷新一致）
- **纯函数下沉 lib/**：路径、比较、布局、CSV/TSV、聚合等逻辑独立测试；DOM 管线由 jsdom 集成测试覆盖
- **运行时配置单一事实源**：`GRID_OPTION_META` 同时约束 Core 更新策略、运行时输入净化、Vue runtime props 与 React 动态 props；新增 GridOptions 未登记时 TypeScript 直接报错
- **最小权限依赖**：所有 Service/Renderer 构造器只接收 `Pick<GridCore, ...>` 所声明的能力，不能无意访问整个内核
- **实例状态不污染 DOM**：单元格/表头/明细销毁器和计时器保存在 WeakMap，组件注册支持每个 Grid 独立覆盖

## 三窗格与虚拟滚动

```
┌ header ──────────────────────────────────────┐
│ [left pane][   center viewport   ][right pane]│
├ body ────────────────────────────────────────┤
│ [left pane][   center viewport   ][right pane]│
│            ↑ 唯一滚动源（overflow auto）      │
└──────────────────────────────────────────────┘
```

- 左右固定列物理隔离（非 sticky），中心滚动时 header/pinned 行仅做 `transform` 同步
- 行池：`slot = pool[index % poolSize]`，`index+nodeId` 双校验跳过未变行
- 变高行使用 Fenwick 树维护高度与偏移，单行更新/定位均为 `O(log n)`；服务端已知总量不会按总行数分配高度数组
- 列虚拟化：中窗格 20+ 列时表头与正文都只挂载可视列；表头组件和单元格 renderer 离窗时执行 `destroy`，重入窗口时按同一列契约重建

## 扩展新特性

业务/可选功能优先实现为 `GridFeature`，通过 `options.features` 注册。Feature 以 `key/version/requires/conflicts` 声明清单，初始化前完成去重、依赖排序、缺失依赖、冲突与循环隔离。Feature 只获得稳定的 `GridFeatureContext`（api/root/options/events/error），替换或销毁时自动逆序执行 cleanup/destroy，不需要修改 GridCore；实际启用清单可从 `getDiagnostics().activeFeatures` 读取。

只有基础行列模型或渲染管线能力才进入内核：

1. `types/` 加配置/事件类型；同步登记 `GRID_OPTION_META`（编译器保证不遗漏适配层）
2. 算法优先写成 `lib/` 纯函数或独立状态模型；确需生命周期再建 Service
3. Service 构造器声明最小 `Pick<GridCore, ...>`，避免全量依赖
4. GridCore 仅负责组合，渲染层按需消费
5. 单测 + jsdom 集成 + Vue/React 适配测试；用户路径进入 Playwright 三浏览器 E2E

红线：内核零运行时依赖；公共 API 的签名变更必须保持调用兼容并补迁移说明。

## 发布流

changesets（Core、Vue、React、可选 XLSX 四包 fixed 版本联动）→ CI（lint + typecheck + coverage + API/复杂度/体积 + packages/examples/docs + Playwright）→ `build:release` 生成不携带 sourcemap 的发布产物 → publish。详见根 README「开发与贡献」。
