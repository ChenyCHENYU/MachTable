# 框架运行时与类型消费验证

先用 `pnpm build:release` 构建当前候选产物，再执行：

```bash
node scripts/check-framework-compatibility.mjs
# 仅验证一档；--list 只展示固定矩阵，不打包或联网
node scripts/check-framework-compatibility.mjs --case vue-minimum
node scripts/check-framework-compatibility.mjs --list
```

`cases.json` 固定最低 peer、项目锁文件和核对当日官方 npm 稳定版本。更新固定版本时同步 `checkedOn`；执行时不使用 `latest` 或浮动范围，不改变项目主锁文件及框架 overrides。矩阵并不等价于覆盖 peer 声明范围内的所有版本。

包版本和框架运行时标识都严格核对。官方 React 18.0.0 包的 `React.version` 为 `18.0.0-fc46dba67-20220329`，该固定例外通过 `runtimeVersion` 精确登记；不按模糊前缀忽略未知预发布后缀。

执行器通过 `pnpm pack` 生成 Core 与适配器 tarball，使用隔离临时消费者从官方 npm 安装精确框架版本与 jsdom；安装禁用生命周期脚本、审计与开发者个人 npm 配置。每个消费者核对实际框架版本、包版本及完整 `dist` 路径/内容摘要，避免误测工作区源码、另一个框架实例或旧发布产物。结束时删除临时消费者，保留 JSON 证据，默认路径为 `node_modules/.cache/framework-compatibility.json`，可用 `--report /absolute/path/report.json` 指定。

覆盖公开 ESM 组件与 `/workflows` 导入、挂载、编辑确认/撤销、远程工作流、动态数据与列更新及卸载；React 另验证 StrictMode 创建/销毁重放，更新不能无故重建表格。非预期框架警告、DOM 错误、未销毁实例与未解除观察登记会失败。测试的 ResizeObserver 与尺寸为 jsdom 确定性替身，不能证明真实浏览器观察器或布局行为。

每档同时使用固定的 TypeScript 5.7.3/5.9.3、匹配的 React 18/19 类型包和 Vue 编译器，检查实际安装包的完整 SFC/TSX、ESM/CJS 声明、全部公开代码入口与 CSS 类型入口。`skipLibCheck: false`；另用错误 props 反例确认检查器确实拒绝非法类型，避免仅解析片段。复用 `tests/consumer` 夹具，不引入工作区路径替身。

正例还必须实际产出业务消费者自身的 `.d.ts`，逐文件核对输出，防止 `noEmit` 检查遗漏无法命名的外部类型（TS4023）。声明输出结果单列为 `esmEmit`，最低 Vue 档仍与独立上游基线精确比较。

Vue 3.2.0 在现代 TypeScript 下有自身的 `HostElement` 声明错误。最低档必须与不导入 MachTable 的独立 Vue 基线**逐字一致且仅有这一条错误**，增加任何本库错误都会失败；报告明确区分 `ownDeclarationsPassed` 与 `fullDeclarationsPassed`，控制台也提示限制。新增 Vue 3.2.47 档完整检查 3.2 系列的声明，不把最低档的上游限制写成完整类型通过。

该任务只证明记录中的固定组合。CSS 视觉、实际滚动/布局、真实浏览器/读屏及完整业务链分别由对应门禁或人工验收覆盖。报告中的产物摘要用于关联具体候选版本，不把一次通过推广为所有未来版本兼容。

执行器运行在 Linux/macOS Node 环境，Windows 可使用 WSL。它不会启动浏览器；macOS Codex 的 seatbelt 若限制 pnpm 或网络，应通过执行工具对这条具体命令使用 `sandbox_permissions=require_escalated`，保留环境标记，不绕过审批。
