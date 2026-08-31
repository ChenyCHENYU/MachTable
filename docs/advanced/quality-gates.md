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
| `pnpm typecheck` | Core、Vue、React 严格类型检查 |
| `pnpm check:complexity` | 圈复杂度增量门禁 |
| `pnpm check:complexity:update` | 仅在评审确认后收紧历史复杂度基线；不得用于放宽上限 |
| `pnpm check:api` / `pnpm check:api:update` | 校验公开 export、Grid API/Options/Event 成员签名快照 / 评审后更新快照 |
| `pnpm check:deps` | 生产依赖、未声明引用、无法解析引用和循环依赖检查 |
| `pnpm check:package-readmes` | 校验 npm README 嵌入开关、包名与授权说明，防止包页面文档为空或漂移 |
| `pnpm build:runtime` / `pnpm build:release` | 跳过声明的快速运行时构建 / 含声明且不发布 sourcemap 的正式构建 |
| `pnpm check:release-artifacts` | 校验发布目录解压体积并阻止 `.map` 泄漏到 npm 包 |
| `pnpm test` / `pnpm test:coverage` | 单元测试 / 覆盖率阈值 |
| `pnpm quality:quick` | 推送前的快速代码检查 |
| `pnpm verify` | 不含浏览器 E2E 的完整仓库验证 |
| `pnpm test:e2e` | Chromium、Firefox、WebKit 集成测试 |

## 复杂度治理

新建或新超标的函数圈复杂度上限为 `15`。历史热点记录在 `scripts/quality/complexity-baseline.json`，门禁遵循以下规则：

1. 新函数不得超过 `15`。
2. 已登记函数不得高于自己的当前基线，也不得在同一基线项下新增超标函数。
3. 重构降低复杂度会直接通过；基线只会收紧，不因新增需求放宽。
4. 达到上限不是鼓励把逻辑机械切碎。优先按状态转换、输入归一化、副作用边界和业务职责拆分，并让每个单元有稳定名称和测试入口。

复杂度基线是迁移机制，不是永久豁免。当前最高风险的配置更新、配置解析、键盘导航、状态恢复和 Vue 远程查询已先行拆分；剩余渲染与交互热点按业务改动就近偿还。若确实存在算法不可避免的高分支，必须在评审中说明不拆分的理由与覆盖用例，不能直接提高全局阈值。

## 类型与异步安全

公开 API 结构由 `api/public-api.snapshot.json` 锁定，生命周期规则由 `api/public-api-policy.json` 声明。任何删除、改名、新增或参数/返回值签名变化都会让 `check:api` 失败；贡献者必须先确认兼容策略、同步 Changelog/升级文档，再显式更新快照。快照覆盖 Core/Worker、Vue/React 和 XLSX 公开入口，并与 TypeScript consumer fixture 互补：前者检查结构漂移，后者检查真实 ESM/CJS/Vue SFC 消费。

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
- 发布任务只有在静态、单测、包、文档和 E2E 五类任务全部通过后才会启动。

## 提交规范

提交必须使用 `type(scope): subject`，例如：

```text
fix(core): preserve row state after datasource refresh
refactor(vue): split remote query request lifecycle
ci(quality): run package and browser gates independently
```

scope 必填但不使用封闭枚举，以便新增独立模块时无需先修改工具配置。常用 type 包括 `feat`、`fix`、`perf`、`refactor`、`docs`、`test`、`build`、`ci`、`chore` 和 `revert`。

不要使用 `--no-verify` 规避失败。若门禁误报，应修正规则或提供精确例外，让后续贡献者得到同样可靠的结果。
