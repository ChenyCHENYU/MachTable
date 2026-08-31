# 架构设计

MachTable 采用“小内核、显式边界、组合扩展”的混合架构。状态与资源生命周期使用 class service；可测试算法使用纯函数；公开能力使用冻结的领域 API；框架差异留在适配层。

## 分层

```text
应用业务
├─ Vue Adapter / React Adapter / Vanilla createGrid
│  ├─ 配置合并、props 更新、组件生命周期
│  └─ 可选 workflows / ui / adapters / worker
├─ Frozen GridApi
│  ├─ rows / columns / selection / editing
│  ├─ filtering / sorting / pagination / hierarchy
│  └─ view / state / io / diagnostics
├─ GridCore 编排
│  ├─ Row/Column models
│  ├─ Selection/Editing/Keyboard/Drag services
│  ├─ Remote cache/State persistence/Feature lifecycle
│  └─ Update scheduler/Event boundary
├─ DOM 渲染
│  ├─ 三窗格表头与正文
│  ├─ 行列虚拟化、固定行、覆盖层
│  └─ renderer/editor 生命周期
└─ 纯函数与类型
   ├─ filter/sort/layout/path/csv/state/config
   └─ GridOptions/ColDef/Events/GridApi
```

依赖方向只向下。适配器可以消费 Core 的公共入口和受控 `/adapter` 桥，但 Core 不依赖 Vue/React；renderer 不拥有业务模型；纯函数不访问 DOM。

## 目录职责

```text
packages/core/src/
├─ types/       # 公共类型事实源
├─ core/        # GridCore、createGrid、Option 元数据与更新调度
├─ services/    # 有状态模型和交互服务
├─ render/      # DOM 渲染与虚拟化视图
├─ lib/         # 纯函数、状态 store、schema、locale、CSV 等
└─ __tests__/   # 纯函数、jsdom 集成、语义和治理测试
```

框架包内部：

```text
packages/vue|react/src/
├─ MachTable.*          # 薄组件适配
├─ defaults.*           # scoped 配置
├─ useMachTable.*       # 生命周期 API
├─ useMachTableQuery.*  # 可选远程工作流
├─ useMachTableEditing.*
├─ adapters.*           # 组件 renderer 桥
└─ ui/worker/editors entries
```

## 数据流

```text
用户交互 / public API / framework props
              ↓
Option 校验与 update scheduler
              ↓
Service / model 计算
              ↓
类型化事件与状态持久化
              ↓
按失效级别更新 DOM
```

同一同步业务动作可以由 `api.batch()` 包裹；调度器会合并模型、布局和渲染请求。`updateOptions()` 先完整校验 patch，再一次性提交，非法字段不会部分污染实例。

## API 门面

公开 `GridApi` 不是内部实现类。创建时返回冻结门面，12 个领域按首次访问惰性构造并缓存：

- 防止用户覆写方法或获得内部 service。
- 每个命令只有一个公共名称。
- 内部可拆分服务，不破坏消费端结构。
- 领域接口可以独立做签名与语义门禁。

根级仅保留生命周期、配置、事件和批处理。内部 `GridApiImpl` 可拥有更细的编排方法，但不能从 package entry 导出。

## 状态与持久化

`GridState` 是唯一完整工作区快照，当前 schema 为 v2。`initialState`、`api.state.apply()` 与 `persistence` 共用相同归一化路径。

```text
state-changing event
       ↓
debounced persistence coordinator
       ↓
selected sections → GridStateStore.save(key, snapshot)
```

自动持久化不存在第二套列 store。`sections: ["columns"]` 只提取列区段；未配置 `persistence` 时不会写存储。

## 三窗格与虚拟化

```text
header [left fixed] [virtual center] [right fixed]
body   [left fixed] [virtual center] [right fixed]
                         ↑
                   单一滚动源
```

- 左右固定列物理隔离，中心滚动只同步必要 transform。
- 行池按展示索引复用，重用前同时校验索引与 node ID。
- 中间列超过阈值时表头和正文只挂载可见列。
- 可变行高使用 Fenwick 索引，单点高度更新和偏移查询为 `O(log n)`。
- renderer/editor 离开窗口或实例销毁时执行清理。
- 远程随机块采用有界 LRU、并发上限、优先队列、去重和 AbortSignal。

## class 与函数如何选择

class 适用于：

- 持有监听器、观察器、计时器、DOM 或请求。
- 维护缓存、历史栈和生命周期不变量。
- 需要明确 `destroy()` 或替换边界。

纯函数适用于：

- 排序、过滤、路径、状态归一化和配置合并。
- 输入输出确定、无资源所有权的算法。
- 可在主线程与 Worker 共享的逻辑。

这不是“类优于函数”或相反；依据所有权和副作用选择，能比全类或全函数更易维护。

## 扩展机制

业务扩展优先使用：

1. `ColDef` renderer/editor/formatter/validator。
2. 实例或应用级 `components`。
3. `GridFeature`。
4. 独立可选包与子入口。

`GridFeature` 用 `key/version/requires/conflicts` 声明关系，Core 在 setup 前完成去重、依赖排序、版本检查、冲突和循环隔离。Feature 只获得稳定 Context，销毁时逆序清理。

不要继承 `GridCore`，不要从内部目录 deep import，也不要把单一客户业务硬编码进 Core。

## 配置事实源

`GRID_OPTION_META` 同时驱动：

- Core 初始值与运行时 patch 校验。
- 更新失效级别。
- Vue runtime props。
- React 动态 prop 比较。
- API/消费端门禁。

新增 `GridOptions` 字段而没有登记元数据会在 TypeScript 或测试阶段失败。

## 性能边界

- 正常页面不加载 workflows、UI、Worker、框架 adapter 或 XLSX 子入口。
- Core 零运行时依赖。
- 简单文本优先 formatter/函数 renderer，富组件按需挂载。
- 大型本地计算达到阈值后才交给 Worker，小数据保持同步低延迟。
- 批处理、局部刷新和事务优先于全量数据重建。

## 质量与发布

发布流水线：

```text
lint/typecheck/complexity/API/dependencies
                  ↓
unit + coverage + framework tests
                  ↓
release build + publint + consumer exports + size
                  ↓
examples + docs + E2E/performance
                  ↓
fixed-version packages + npm publish
```

Core、Vue、React 与 XLSX 使用同一版本线。API 快照、复杂度预算、包体预算和真实消费端构建阻止内部重构意外扩大公共面或破坏接入。
