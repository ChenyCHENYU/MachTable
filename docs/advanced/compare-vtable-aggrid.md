# MachTable、VTable 与 AG Grid：2026-10 对照

基线为 MachTable 0.29.2 源码、类型和示例，以及 2026-10-02 查阅的厂商官方文档。这是能力与产品边界分析；不同渲染引擎的“百万行”宣传不构成同机性能结论。AG Grid 的 Community 与 Enterprise 能力须分别判断。

| 场景 | MachTable 当前状态 | VTable | AG Grid |
| --- | --- | --- | --- |
| 复杂 B 端列表 | 双向虚拟化、远程平面块、编辑事务、Vue/React 适配 | Canvas 列表表格，支持图片、进度条、迷你图等单元格 | DOM 虚拟化、丰富列/行交互与工具面板 |
| 分组与层级 | 本地分组聚合、树懒加载；远程随机块限平面数据 | 多维透视表和树形行/列表头 | Enterprise 服务端行模型支持分组、聚合、树与透视 |
| 编辑与选择 | 单元格/整行事务、批量保存、冲突、范围与撤销 | 单元格编辑；聚合后的多源单元格不能直接回写源记录 | 编辑、批处理与撤销；排序、过滤等操作会清空撤销栈 |
| 报表与导出 | 本地 CSV、可选 XLSX 桥接；远程全量需业务后端 | 合并单元格、透视组合图、Sheet、导出插件 | Enterprise Excel 导出可定制样式、多 Sheet 与更多布局 |
| 生态与示例 | 工程示例和配方已有，场景索引仍需继续扩充 | 大量视觉示例及独立 Gantt/Sheet 产品 | 系统化文档、模块注册、框架示例与商业支持 |

官方依据：[VTable 基本表格](https://visactor.com/vtable/guide/table_type/List_table/List_table_overview)、[透视表](https://visactor.com/vtable/guide/table_type/Pivot_table/pivot_table_useage)、[透视组合图](https://visactor.com/vtable/guide/table_type/pivot_chart)、[编辑边界](https://visactor.com/vtable/guide/edit/edit_cell)、[表格导出](https://visactor.com/vtable/guide/plugin/table-export)；[AG Grid 功能目录](https://www.ag-grid.com/javascript-data-grid/)、[服务端分组](https://www.ag-grid.com/javascript-data-grid/server-side-model-grouping/)、[撤销重做](https://www.ag-grid.com/javascript-data-grid/undo-redo-edits/)、[Excel 导出](https://www.ag-grid.com/javascript-data-grid/excel-export/)。

## 能力取舍

| 判断 | 能力 | 原因与验收边界 |
| --- | --- | --- |
| 应该有，已补 | 远程全量导出的查询快照 | 已有客户端导出只覆盖浏览器持有的数据。0.30.0 增加独立请求快照，携带可见列、排序、过滤和跨页选择规则；后端仍负责鉴权、执行与文件生成。 |
| 应该有，按需建设 | 可选服务端分组 Store | 当前随机块数据源面向平面行；真实项目提出跨页分组/聚合需求时，先明确分组键、缓存失效、展开与汇总协议，再增加独立入口。 |
| 应该有，按需建设 | 可复用业务场景示例 | 现有工程展示组件能力，仍需订单、台账、BOM、长列表等可复现业务路径；以接入时间、异常恢复和实际设备测试验收。 |
| 需要细化 | 远程数据与选择语义 | 区分客户端全量、服务端分页和随机块；明确筛选变化后的旧响应处理、跨页全选的排除规则，以及导出范围。 |
| 需要细化 | 批量编辑失败处理 | 底层事务、校验和冲突结果已有；可选失败审阅界面应定位失败行、允许重试且不改变原有提交默认值。 |
| 需要细化 | 可访问性与性能证据 | 保留键盘/ARIA 自动化门禁，补真实读屏和业务设备矩阵；跨产品性能只通过相同数据与任务的基准判断。 |
| 暂不需要进入 Core | 完整 Pivot、公式、Gantt 和图表引擎 | 这些是独立分析或电子表格产品线，规模与语义会侵入列表/录入主路径；先由可选扩展或业务应用验证需求。 |
| 暂不需要进入 Core | Canvas 重写与无约束合并单元格 | DOM 单元格是现有编辑、框架组件和可访问性的基础；若有报表合并需求，先约束为受控只读场景并做兼容验证。 |

0.30.0 的交付仅覆盖表中的“已补”项及文档入口。其余是候选方向，不表示已经提供，也不作为现有项目的默认行为。

## 优先顺序

1. **先完善项目接入证据。** 使用[场景示例](/guide/scenarios)覆盖订单、工业台账、BOM 树、远程长列表和导出，记录接入工时、异常恢复与真实设备表现。
2. **明确远程数据契约。** 本次先提供[服务端导出请求快照](/recipes/remote-export)，保留现有 CSV/XLSX 行为；下一步按实际项目需要设计可选服务端分组 Store、汇总与缓存失效协议。
3. **补业务操作界面。** 高级过滤 AST 和批量保存结果已有，筛选构建器与失败审阅面板可作为可选 UI 实现，不增加简单表格的初始加载成本。
4. **以项目证据决定分析扩展。** 动态结果列、受控只读合并和轻量数据条可按报表需求立项。完整 Pivot、公式、Gantt、图表引擎与 Canvas 重写不进入 Core 路线。

## 兼容性原则

已有 `GridApi`、`GridOptions`、渲染和编辑默认行为保持稳定。新增能力采用独立函数、可选入口或业务适配层；需要后端协议的能力由业务项目显式接入。发布前依次验证 API 快照、类型、单元测试、浏览器集成、消费端构建、文档与发布产物。
