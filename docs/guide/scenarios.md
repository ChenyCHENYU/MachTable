# 场景示例

下面的入口按业务任务组织。可运行工程位于仓库的 `examples/vanilla`、`examples/vue`、`examples/react` 和 `examples/bench`；各配方给出独立的接入代码与行为边界。

| 场景 | 起点 | 重点验收 |
| --- | --- | --- |
| 订单列表与远程分页 | [远程查询](/recipes/remote-query)、[行选择](/recipes/selection) | 查询变化后旧响应不覆盖新数据；跨页选择使用稳定 ID |
| 工业台账与批量录入 | [整行编辑](/recipes/editing)、[批量保存](/recipes/batch-save)、[撤销重做](/recipes/undo-redo) | 校验、部分成功和版本冲突均可定位到行 |
| BOM 树与按需展开 | [树表懒加载](/recipes/tree-lazy-loading)、[行分组](/recipes/grouping-tree) | 展开取消、父子选择、过滤保留祖先链 |
| 百万级平面长列表 | [随机块数据源](/recipes/random-access-datasource)、[性能指南](/advanced/performance) | 跳转、重试、缓存淘汰及销毁后资源释放 |
| 报表导出 | [本地 CSV/XLSX](/recipes/pagination-io)、[服务端全量导出](/recipes/remote-export) | 导出范围清楚；远程全量任务由后端处理 |

选择场景时先确认数据归属：本地全量数据可由浏览器排序、过滤和导出；服务端只返回一页或有限缓存时，跨页聚合与全量导出必须由服务端完成。
