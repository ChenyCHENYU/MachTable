# 场景示例

## 主表与多张明细同屏

普通主表不传 `preset`，默认使用 `list`。局部明细只加 `preset="detail"`，页面不用重复表头开关、分页和高度配置：

```vue
<section class="material-groups">
  <article v-for="group in groups" :key="group.id">
    <h3>{{ group.name }}</h3>
    <MachTable preset="detail" :column-defs="materialColumns" :row-data="group.rows" row-key="id" />
    <footer>合计 {{ group.total }}</footer>
  </article>
</section>
<div style="height: 420px">
  <MachTable :column-defs="allMaterialColumns" :row-data="allMaterials" row-key="id" />
</div>
```

分组标题、合计、操作按钮和页面网格由项目已有组件组合；表格负责自身呈现与交互。明细按内容收起，330px 表体上限防止单组内容过多挤压整页。序号默认保留，需要业务专用序号或隐藏时由单表覆盖。主题与 `size` 统一继承，不用为大表、小表各维护一套样式。

每张表只接收自己的行数组与稳定主键。同一套列定义可以复用，明细之间的排序、选择、编辑和滚动状态各自隔离。需要统一改变明细上限时，在可选配置中用 `createMachTablePreset("detail", { maxBodyHeight: 240 })` 定制一次。具体覆盖规则见[场景与配置](/guide/configuration)。

## 按任务选择数据模型

可运行工程位于 `examples/vanilla`、`examples/vue`、`examples/react` 和 `examples/bench`；配方给出接入代码与行为边界。

| 场景 | 起点 | 重点验收 |
| --- | --- | --- |
| 订单列表与远程分页 | [远程查询](/recipes/remote-query)、[行选择](/recipes/selection) | `bindings` 连接分页和请求状态，旧响应不覆盖新数据 |
| 工业台账与批量录入 | [整行编辑](/recipes/editing)、[批量保存](/recipes/batch-save)、[撤销重做](/recipes/undo-redo) | 校验、部分成功和版本冲突均可定位到行 |
| BOM 树与按需展开 | [树表懒加载](/recipes/tree-lazy-loading)、[行分组](/recipes/grouping-tree) | 展开取消、父子选择、过滤保留祖先链 |
| 百万级平面长列表 | [随机块数据源](/recipes/random-access-datasource)、[性能指南](/advanced/performance) | 跳转、重试、缓存淘汰及销毁后资源释放 |
| 报表导出 | [本地 CSV/XLSX](/recipes/pagination-io)、[服务端全量导出](/recipes/remote-export) | 导出范围清楚；远程全量任务由后端处理 |

本地全量数据可由浏览器排序、过滤和导出；服务端只返回一页或有限缓存时，跨页聚合与全量导出交给服务端。复杂页面仍复用已有查询、编辑、表单与弹窗组合，不另外设计一套表格请求协议。
