# MachTable 长稳回归

独立消费已构建的 Core。默认持续 **30 分钟**，交替动态列、列宽/固定列、远程随机块、选中、真实输入框提交、撤销/重做、回滚、查询取消及带在途请求的销毁。不会修改运行时代码、默认包体或正常 E2E 的时间预算。

```bash
pnpm --filter @agile-team/mach-table build
pnpm exec tsc --noEmit -p tests/stability/tsconfig.json
# 30 秒短检：验证夹具及断言可执行，不作为长稳验收。
MACH_SOAK_SECONDS=30 MACH_SOAK_SAMPLE_SECONDS=2 pnpm exec playwright test --config playwright.stability.config.ts
# 默认 30 分钟，12 个暖机周期不计入测量时长。
pnpm exec playwright test --config playwright.stability.config.ts
```

macOS Codex `CODEX_SANDBOX=seatbelt` 必须通过执行工具对上述具体浏览器命令使用 `sandbox_permissions=require_escalated`，由实际审批决定执行；全局 setup 在浏览器启动前拒绝 seatbelt，不能删除环境标记或使用 `--no-sandbox` 绕过。普通终端按项目约定运行。

## 测量与断言

- 每个周期：最多 6 个缓存块（4 块预算及焦点/进展保护余量）、可见单元格少于 2,000；编辑/撤销/重做结果正确，回滚后无脏行。查询切换及销毁都先等待指定查询真正进入 `getRows`，确认存在活动传输，再取消并检查对应取消计数增长；被测请求只由 `AbortSignal` 结束，不靠固定延迟碰时序。销毁后缓存、表格 DOM、模拟传输归零。
- 暖机后与各采样点，通过 Chromium CDP 显式 GC 两次，再读取 `Runtime.getHeapUsage` 和 `Memory.getDOMCounters`。弱引用登记的已销毁网格 root 不应存活，不以只检查文档中的 root 数量代替释放检查。
- 三个基线样本与最后三个样本分别取堆中位数，增长上限 8 MiB，任一样本相对基线的峰值增长上限 16 MiB。最终文档数不能增加，DOM 节点最多增长 32，监听器最多增长 8。预算用于捕获持续回归，允许浏览器内部少量惰性分配；不等于允许实例持续泄漏。
- 记录全部 GC 后堆样本、线性趋势、浏览器版本、周期数、缓存/DOM 峰值及错误。趋势不设短时毫秒/FPS 门槛；30 秒结果不能推导长期泄漏速率。
- `pageerror`、`console.error` 和 Core `onGridError` 均作为失败，只保存有界字符串，不保存事件、Error 或 DOM 引用。正常取消由模拟传输处理，不产生错误；不以宽泛的 Abort 文本过滤掩盖内部异常。

`test-results/stability-results.json` 是 Playwright 机器报告，`stability-metrics` 附件含具体测量。失败也会保留附件。单独工作流支持手动执行及每周执行，产物保留 21 天；远端执行结果必须以真实 job 为准，工作流文件存在不代表已通过。

这是有限、确定性的 Chromium 合成负载。它不覆盖真人读屏、真实服务端权限/事务、多用户实际并发、全部浏览器和任意自定义 renderer；GC 后堆预算通过不构成“绝无内存泄漏”的证明。表格 + 表单 + 弹层 + tags 的应用级组合由 RobotAdmin 回归补充。
