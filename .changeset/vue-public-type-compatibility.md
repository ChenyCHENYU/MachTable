---
"@agile-team/mach-table-vue": patch
"@agile-team/mach-table": patch
---

修正 Vue 3.2 消费生成声明时对较新 Vue 内部类型的依赖。公开浅引用使用兼容的 Ref 契约，工具栏声明显式限定 props；运行时继续使用 shallowRef，调用方式与追踪行为保持不变。

横向虚拟窗口重排时保留既有合并单元格宽度，避免先缩到基础列宽再还原，触发 WebKit 编辑焦点的原生滚动回跳。真实调整超宽编辑输入自身宽度后的 WebKit 原生边界仍单独记录，不扩大此修复的覆盖范围。
