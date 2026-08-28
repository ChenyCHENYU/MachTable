# 主题与密度

MachTable 的视觉体系由 **分层设计令牌** 驱动：全部样式限定在 `.mach-root` 作用域内，客户可按三种深度定制，与宿主 UI 库零冲突。

## 令牌分层

```
基础令牌（primitive）      语义色 / 圆角 / 阴影 / 间距 / 字号 —— 客户品牌层通常只改这里
        ↓ 派生
组件变量（component）      表头/行/斑马纹/焦点 等 --mach-* 变量引用基础令牌
        ↓ 组合
结构类名（anchor）         .mach-header-cell / .mach-row--selected … 精确样式锚点
```

## 完整变量表

### 品牌与语义色

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `--mach-primary` | `#2563eb` | 主色：选中/焦点/排序指示/填充柄/链接 |
| `--mach-primary-weak` | `#dbeafe` | 主色弱底（徽标/过滤 tag） |
| `--mach-success` / `--mach-warning` / `--mach-danger` / `--mach-info` | `#16a34a` / `#d97706` / `#dc2626` / `#0284c7` | 语义色（statusTag 等预设、操作按钮 danger 态） |

### 边框与线条

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `--mach-border-color` | `#e6eaf0` | 外框/表头分隔 |
| `--mach-row-border-color` | `#eef1f6` | 行分隔线（更淡，留白质感） |
| `--mach-cell-border-color` | `transparent` | 纵向网格线（`showCellBorders` 时覆盖） |
| `--mach-border-width` | `1px` | 通用线宽（0.5px 细线质感可覆写） |
| `--mach-header-border-width` | `1px` | 表头底线宽 |
| `--mach-header-accent-color` | `var(--mach-border-color)` | **表头强调底线色**——设为品牌色即得经典强调线风格 |

### 底色与前景

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `--mach-header-bg` / `--mach-header-group-bg` | `#fafbfd` / `#f4f6fa` | 一级表头 / 多级表头分组行（自带层次差） |
| `--mach-header-fg` | `#475569` | 表头文字 |
| `--mach-body-bg` / `--mach-body-fg` | `#ffffff` / `#26303f` | 表体底/文字 |
| `--mach-row-hover-bg` / `--mach-row-selected-bg` / `--mach-zebra-bg` | `#f6f8fa` / `#eff6ff` / `#fafbfd` | 悬停/选中/斑马纹 |

### 焦点与滚动条

| 变量 | 默认 |
| --- | --- |
| `--mach-cell-focus-color` / `--mach-focus-width` | `#2563eb` / `1.5px` |
| `--mach-scrollbar-thumb` | `#c9d2dd` |

### 排版

| 变量 | 默认 |
| --- | --- |
| `--mach-font-family` | 系统栈含 PingFang/雅黑 |
| `--mach-font-size` / `--mach-font-size-sm` | `13px` / `12px` |
| `--mach-header-font-weight` | `600` |
| `--mach-cell-padding` | 按密度 6/9/12px |

### 形状 / 阴影 / 动效 / 层级

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `--mach-radius-sm` / `--mach-radius` / `--mach-radius-lg` | `4px` / `6px` / `8px` | 按钮 / 输入 / 弹层圆角 |
| `--mach-shadow-sm` / `--mach-shadow` | 见 CSS | 浮标 / 弹层阴影 |
| `--mach-transition` | `0.15s ease` | 行悬停、进度条、表头文字过渡（设 `0s` 关闭） |
| `--mach-z-overlay` / `--mach-z-loading` / `--mach-z-popup` / `--mach-z-menu` | `10` / `15` / `1000` / `1001` | 覆盖层/加载浮标/弹层/菜单——**客户页面 header 盖住弹层时覆写这里** |

## 密度

```ts
createGrid(host, { size: "compact" });   // 12px / 30px / 6px
createGrid(host, { size: "normal" });    // 13px / 36px / 9px（默认）
createGrid(host, { size: "large" });     // 14px / 44px / 12px
api.updateOptions({ size: "large" });    // 运行时切换
```

非标密度直接覆写：`.mach-root { --mach-row-h: 28px; }`。

## 客户定制三种深度

### 深度一：换变量（推荐，5 分钟）

```css
/* 客户品牌：绿色 + 圆角 + 表头品牌强调线 */
.brand-grid {
  --mach-primary: #0a7d55;
  --mach-primary-weak: #0a7d5522;
  --mach-header-accent-color: var(--mach-primary);  /* 表头底边强调线 */
  --mach-radius: 8px;
  --mach-row-h: 32px;
}
```

```ts
createGrid(host, { className: "brand-grid" });
```

### 深度二：整套主题类（暗色已内置）

```css
/* 参照 .mach-theme-dark 的写法整表覆写 —— 适合多客户 SaaS 按租户下发 */
.tenant-orange { /* 覆盖全部变量 */ }
```

暗色：`className: "mach-theme-dark"`（含语义色/阴影/滚动条 color-scheme 适配，跟随 EP `html.dark` 的桥接见 [Element Plus 集成](/guide/element-plus)）。

### 深度三：结构类名精修（兜底）

任何细节都能通过类名锚点覆写（滚动条、分隔线、某列底色等）：

```css
.brand-grid .mach-row--selected .mach-cell { background: #0a7d5518; }
.brand-grid .mach-body-viewport--scroll::-webkit-scrollbar { width: 6px; }
```

## 表头与多级表头展示规则

- 一级表头：`--mach-header-bg` 底 + `--mach-header-fg` 600 字重 + 底部 `--mach-header-accent-color` 强调线（默认灰，可品牌化）
- 多级分组行：`--mach-header-group-bg` 略深制造层次，文字居中，底边常规分隔线
- 排序激活列：表头文字变 `--mach-primary`（与指示图标同色）
- 过滤激活列：漏斗图标高亮 + 条件摘要 tag
- 行悬停/选中/斑马纹：单元格背景继承行状态，过渡 `--mach-transition`

## 视觉开关

| 选项 | 效果 |
| --- | --- |
| `stripedRows` | 斑马纹 |
| `showCellBorders` | 纵向网格线（默认留白分区） |
| `suppressRowHoverHighlight` / `suppressHeaderFocus` | 关闭悬停 / 表头焦点环 |

## 内置单元格组件样式（预设渲染器配套）

| 类名 | 说明 |
| --- | --- |
| `.mach-tag`（`--success/--warning/--danger/--info/--neutral`） | 状态徽章：色点 + 胶囊底（`color-mix` 语义色 10% 透明底） |
| `.mach-progress`（`__track/__bar/__label`） | 进度条：圆角轨道 + 主色填充（宽度带过渡） |
| `.mach-link` | 链接样式单元格 |
| `.mach-actions` / `.mach-action-btn`（`--icon/--danger`） | 操作按钮组：图标按钮 24px，danger 悬停变红 |

## 结构类名速查

| 类名 | 元素 |
| --- | --- |
| `.mach-root` / `.mach-header` / `.mach-body` | 根 / 表头区 / 表体区 |
| `.mach-header-cell`（`--leaf/--group/--sorted/--dragging`） | 表头单元格 |
| `.mach-row`（`--selected/--hover/--odd`） / `.mach-cell`（`--num/--focus/--range/--wrap…`） | 行 / 单元格 |
| `.mach-pinned-rows--top/--bottom` / `.mach-footer` / `.mach-statusbar` | 固定行 / 合计行 / 状态栏 |
| `.mach-overlay` / `.mach-infinite-loading` | 覆盖层 |
| `.mach-filter-panel` / `.mach-context-menu` / `.mach-column-panel` | 弹层 |
| `.mach-fill-handle` / `.mach-row-drag-handle` / `.mach-detail-toggle` / `.mach-editor-input` | 手柄 / 编辑器 |

## 数字对齐

数值列自动右对齐 + `font-variant-numeric: tabular-nums`；列 `type: "rightAligned"` 可强制。
