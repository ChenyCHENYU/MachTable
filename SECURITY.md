# Security Policy

## Supported versions

MachTable 处于 `0.x` 阶段。安全修复优先发布到最新 minor；使用方应及时升级 Core 与框架适配器的相同版本。

| Version | Supported |
| --- | --- |
| `0.9.x` | Yes |
| `< 0.9` | No |

## Reporting a vulnerability

请不要在公开 Issue 中披露可利用细节。优先使用 GitHub 仓库的 **Security → Report a vulnerability** 私密报告功能；如果该功能尚未开启，请联系仓库维护者并只提供最小必要信息。

报告建议包含：

- 受影响版本和包；
- 攻击前提、影响范围与最小复现；
- 是否涉及用户输入、HTML、CSV、路径写入或自定义 renderer；
- 建议修复方案（如果有）。

维护者确认后会协调修复、回归测试、版本发布与公告。公开披露时间应在修复版本可用之后。

## Consumer guidance

- 不要将不可信内容与 `allowUnsafeOverlayHtml` 同时使用。
- CSV 公式保护默认开启，不要对外部数据关闭。
- 自定义 renderer/editor 同样属于应用攻击面，必须遵守宿主项目的输出编码和 CSP 策略。
- npm token 只能存放在 Secret 管理系统，不得进入源码、Issue 或构建日志。
