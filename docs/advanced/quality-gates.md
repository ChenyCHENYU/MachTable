# 质量门禁与高效开发

MachTable 的质量体系遵循一个原则：越靠近开发者的检查越快，越完整、越昂贵的检查越靠近 CI。门禁用于阻止真实回归，不把日常维护变成冗长流程。

## 三层反馈模型

| 层级 | 触发方式 | 检查内容 | 目标 |
| --- | --- | --- | --- |
| 提交前 | `git commit` | 仅对暂存的 TypeScript 文件执行 ESLint 自动修复与检查，并执行 `git diff --cached --check` | 数秒内发现局部问题 |
| 提交信息 | `commit-msg` | Commitlint 校验 `type(scope): subject` | 保证历史可检索、可生成变更记录 |
| 本地全量 | `pnpm verify` | 静态检查、覆盖率、包完整性、示例和文档构建 | 推送前完整自检 |
| CI | push / pull request | 静态、单测、包、文档、三浏览器 E2E 并行执行 | 合并与发布的最终事实来源 |

日常小改动不需要反复执行所有任务。开发中可运行目标包测试，准备推送时运行 `pnpm quality:quick`；涉及公共 API、构建、发布产物或跨框架行为时运行 `pnpm verify`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm commit` | 交互式生成规范提交信息 |
| `pnpm lint` / `pnpm lint:fix` | ESLint 全量检查 / 自动修复 |
| `pnpm typecheck` / `pnpm check:examples` | 四包及全部四个示例的严格类型 / Vue SFC 检查 |
| `pnpm test:examples` / `pnpm test:quality` | 固定种子基准数据与构建压缩边界回归 |
| `pnpm check:budgets` | 从同一字节预算定义核对文档，防止门禁漂移 |
| `pnpm check:docs` | 本地链接、包名/子入口/导入与 JSX/TSX 语法；不替代完整业务示例类型或运行验证 |
| `pnpm check:complexity` | 圈复杂度全量门禁（生产函数上限 `15`） |
| `pnpm check:complexity:update` | 仅用于确认基线仍为空；不得增加历史豁免或放宽上限 |
| `pnpm check:api` / `pnpm check:api:update` | 校验公开 export、Grid API/Options/Event 成员签名快照 / 评审后更新快照 |
| `pnpm check:deps` | 生产依赖、未声明引用、无法解析引用和循环依赖检查 |
| `pnpm check:package-readmes` | 校验 npm README 嵌入开关、包名与授权说明，防止包页面文档为空或漂移 |
| `pnpm build:runtime` / `pnpm build:release` | 跳过声明的快速运行时构建 / 含声明且不发布 sourcemap 的正式构建 |
| `pnpm check:release-artifacts` | 校验发布目录解压体积并阻止 `.map` 泄漏到 npm 包 |
| `pnpm test` / `pnpm test:coverage` | 单元测试 / 覆盖率阈值 |
| `pnpm quality:quick` | 推送前的快速代码检查 |
| `pnpm verify` | 不含浏览器 E2E 的完整仓库验证 |
| `pnpm test:e2e` | Chromium、Firefox、WebKit 集成测试 |
| `pnpm test:compatibility` | 在隔离临时项目安装固定框架版本，验证实际打包产物的生命周期与工作流；需要官方 npm 网络 |
| `pnpm check:stability` | 构建后检查独立长稳夹具、配置和测试的严格类型 |
| `pnpm test:stability` | 独立 Chromium 长稳，默认测量 30 分钟；短检须显式设置时长，不能记为长稳通过 |

## 复杂度治理

所有生产函数的圈复杂度上限为 `15`。0.28 已清零原有 31 项历史热点，`scripts/quality/complexity-baseline.json` 的 `allowances` 必须保持为空。门禁遵循以下规则：

1. 新增和已有函数都不得超过 `15`。
2. 不允许通过登记新 allowance、提高阈值或拆成无业务语义的小碎片绕过检查。
3. 若新需求让函数超限，应按状态转换、输入归一化、副作用边界或业务职责重构。
4. 每个拆分单元都应有稳定名称和可验证职责；无法合理拆分的算法必须先提交 ADR 与覆盖证据。

复杂度基线曾是迁移机制，现在已经完成使命。配置更新与解析、键盘导航、状态恢复、渲染、选择、筛选、布局和框架工作流均使用同一上限；如确有不可避免的复杂算法，必须先提交 ADR、可读性证据和覆盖用例，不能直接修改基线。

生产构建会压缩未与公开字段、字符串访问或原生 API 重名的 TypeScript private 成员，以及明确标注 `@internal` 且不跨包暴露的服务类成员；公开契约字段保持原名。`check-runtime-keys` 逐一核对四包生成声明的公共与 protected 成员、构造参数属性和字符串/映射类型键，且拒绝无 ESM/CJS 声明的零覆盖；防止实现压缩破坏消费契约；ESM/CJS 挂载测试同时验证压缩后的真实行为。CSS 在 `styles/` 中维护可读源码，发布到 `dist/`，原有包导入路径保持不变。Core 全量 ESM、真实 createGrid 消费、初始适配器及默认 CSS 沿用原 gzip 预算。

0.32 的六个高级子入口与两份可选 CSS 保留原上限；0.33 的 `/import` 单独限定 4 KiB gzip，默认源码消费图检查禁止引用这些高级模块和样式。npm 解压体积会包含可选产物，因此 `check:release-artifacts` 同时报告原入口可达图、新增可选产物和合计：原 Core 图上限仍为 1,050,000 字节，可选增量上限为 350,000 字节，不把发布包合计当作普通页面下载量。声明与运行时哈希 chunk 按真实依赖归属计算，无归属文件和 sourcemap 均失败。

## 类型与异步安全

公开 API 结构由 `api/public-api.snapshot.json` 锁定，生命周期规则由 `api/public-api-policy.json` 声明。任何删除、改名、新增或参数/返回值签名变化都会让 `check:api` 失败；贡献者必须先确认兼容策略、同步 Changelog/升级文档，再显式更新快照。快照覆盖 Core 根入口、Core adapter/worker、Vue/React 根入口及其 workflows/ui/adapters 子入口和 XLSX，并与 TypeScript consumer fixture 互补：前者检查结构漂移，后者检查真实 ESM/CJS/Vue SFC 消费。

生产源码启用 TypeScript ESLint 的类型感知规则，重点阻止：

- 未处理的 Promise 与错误的异步回调；
- 对非 Promise 值使用 `await`；
- 多余或失效的类型断言；
- 会造成运行时误判的 Promise 条件和事件处理器。

公共 API 中为自动补全保留的开放字符串联合类型，以及泛型边界中的 `unknown` 联合，不作为错误处理。`tsc --noEmit` 仍是完整类型契约的最终检查。

## 测试与发布约束

- 缺陷修复必须包含能复现问题的回归测试。
- Core 纯逻辑优先单元测试；DOM 生命周期使用 jsdom；Vue/React 行为放入对应适配器测试。
- 键盘、焦点、编辑、真实浏览器差异和大数据性能变化使用 Playwright；性能专门覆盖 100k×100、500 列、连续滚动和重复挂载/销毁。
- CI 将重试后才通过的 E2E 视为失败，避免以重试掩盖不稳定测试。
- 覆盖率阈值、包体积预算、ESM/CJS 导出、真实消费端类型检查和许可证检查不得通过降低阈值绕过。
- 发布任务只有在静态、单测、包、文档、E2E 与框架兼容任务全部通过后才会启动。

### 固定框架兼容矩阵

`tests/compatibility/cases.json` 是版本与 CI 用例名单的事实源；矩阵按 2026-11-15 官方 registry 信息固定，不在执行时解析浮动 `latest`。当前覆盖 Vue **3.2.0 / 3.5.42 / 3.5.45**，React 与 ReactDOM **18.0.0 / 18.3.1 / 19.3.1**，分别对应最低 peer、项目主用和当时稳定版本。

执行器先把 Core 和对应适配器打包，再于隔离临时项目安装；不改变主项目 lockfile、overrides 或框架安装。报告核对 tarball SHA512、完整 dist 摘要、安装版本与实际运行时版本，并记录挂载、编辑/撤销、工作流、动态更新和卸载。React 额外验证 StrictMode 的 setup/cleanup 回放。运行器不读取使用者 npm 凭证，完成后清理临时消费者，保留标量 JSON 证据。

这是 **ESM/jsdom 的生命周期与 API 冒烟**。固定几档版本不代表整个 peer 范围、所有 TypeScript 版本或浏览器布局都已通过。CJS、声明及 Vue SFC 的消费检查仍由原有 exports/consumer 门禁负责。

CI 兼容任务消费包检查任务上传的同一份 dist，六档矩阵全部通过才允许进入发布任务。开发者本地 `verify` 保持不隐式下载多套框架；正式发布前须另外执行兼容矩阵，或核对该候选对应 CI 结果。

### 长稳和组合业务

常规浏览器 CI 在完整 E2E 后执行 30 秒长稳夹具短检，验证负载与资源断言可以运行；独立周检/手动任务默认持续 30 分钟，原始指标和报告分别保存。详细测量边界见[性能指南](/advanced/performance)。测试环境类型显式声明；浏览器包不自动引入 Node 环境全局类型，避免开发工具依赖改变生产源码的环境假设。

RobotAdmin 的独立三浏览器表格任务覆盖真实页面操作、tags 恢复和账号/公司偏好隔离；它消费应用实际锁定的正式 npm 包。示例业务响应仍属本地模拟，不能代替真实接口、多业务 UAT 或真人读屏。发布成熟度按[就绪清单](/advanced/release-readiness)分别记录。

## 提交规范

提交必须使用 `type(scope): subject`，例如：

```text
fix(core): preserve row state after datasource refresh
refactor(vue): split remote query request lifecycle
ci(quality): run package and browser gates independently
```

scope 必填但不使用封闭枚举，以便新增独立模块时无需先修改工具配置。常用 type 包括 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`build`、`ci`、`chore` 和 `revert`。

不要使用 `--no-verify` 规避失败。若门禁误报，应修正规则或提供精确例外，让后续贡献者得到同样可靠的结果。
