import { defineConfig } from "vitepress";

export default defineConfig({
  title: "MachTable",
  description: "马赫表格 —— 高性能、零依赖、跨框架的企业级数据表格插件",
  lang: "zh-CN",
  themeConfig: {
    nav: [
      { text: "指南", link: "/guide/overview" },
      { text: "企业接入", link: "/guide/enterprise-integration" },
      { text: "API 参考", link: "/api/grid-options" },
      { text: "场景配方", link: "/recipes/selection" },
      { text: "进阶", link: "/advanced/theming" }
    ],
    sidebar: {
      "/guide/": [
        {
          text: "开始",
          items: [
            { text: "概述", link: "/guide/overview" },
            { text: "快速开始", link: "/guide/getting-started" },
            { text: "企业级项目接入", link: "/guide/enterprise-integration" },
            { text: "配置中心与覆盖规则", link: "/guide/configuration" },
            { text: "React 接入", link: "/guide/react" },
            { text: "Vue 3 接入", link: "/guide/vue" },
            { text: "SSR / Nuxt / Next", link: "/guide/ssr" },
            { text: "许可证与授权", link: "/guide/licensing" },
            { text: "排错手册", link: "/guide/troubleshooting" },
            { text: "版本升级", link: "/guide/upgrading" }
          ]
        },
        {
          text: "UI 库集成",
          items: [
            { text: "Element Plus", link: "/guide/element-plus" },
            { text: "Naive UI", link: "/guide/naive-ui" }
          ]
        }
      ],
      "/api/": [
        {
          text: "API 参考",
          items: [
            { text: "GridOptions 全量配置", link: "/api/grid-options" },
            { text: "ColDef 列定义", link: "/api/col-def" },
            { text: "事件 Events", link: "/api/events" },
            { text: "GridApi 命令接口", link: "/api/grid-api" },
            { text: "模块导出与工具", link: "/api/exports" }
          ]
        }
      ],
      "/recipes/": [
        {
          text: "场景配方",
          items: [
            { text: "控制器与标准工具栏", link: "/recipes/controller-toolbar" },
            { text: "行选择", link: "/recipes/selection" },
            { text: "远程查询与跨页选择", link: "/recipes/remote-query" },
            { text: "列工作台", link: "/recipes/column-workbench" },
            { text: "树表懒加载", link: "/recipes/tree-lazy-loading" },
            { text: "可选 XLSX", link: "/recipes/xlsx" },
            { text: "业务字段、字典与权限", link: "/recipes/business-columns" },
            { text: "操作列与状态列", link: "/recipes/action-columns" },
            { text: "单元格与整行编辑", link: "/recipes/editing" },
            { text: "批量保存与版本冲突", link: "/recipes/batch-save" },
            { text: "框选 / 复制 / 填充", link: "/recipes/clipboard" },
            { text: "排序与过滤", link: "/recipes/sorting-filtering" },
            { text: "高级过滤表达式", link: "/recipes/advanced-filter" },
            { text: "行分组 / 树形数据", link: "/recipes/grouping-tree" },
            { text: "主从明细", link: "/recipes/master-detail" },
            { text: "无限滚动", link: "/recipes/infinite-scroll" },
            { text: "分页 / 导入导出 / 打印 / 水印", link: "/recipes/pagination-io" },
            { text: "固定首末行", link: "/recipes/pinned-rows" },
            { text: "撤销 / 重做", link: "/recipes/undo-redo" },
            { text: "全量状态与工作区", link: "/recipes/grid-state" },
            { text: "命名视图", link: "/recipes/saved-views" },
            { text: "变高行与换行", link: "/recipes/variable-height" },
            { text: "列状态记忆", link: "/recipes/column-state" },
            { text: "Schema 驱动渲染", link: "/recipes/schema-driven" }
          ]
        }
      ],
      "/advanced/": [
        {
          text: "进阶",
          items: [
            { text: "主题与密度", link: "/advanced/theming" },
            { text: "性能指南", link: "/advanced/performance" },
            { text: "国际化 i18n", link: "/advanced/i18n" },
            { text: "可访问性与键盘", link: "/advanced/accessibility" },
            { text: "架构说明", link: "/advanced/architecture" },
            { text: "质量门禁与高效开发", link: "/advanced/quality-gates" },
            { text: "竞品分析与调研计划", link: "/advanced/competitive-analysis" },
            { text: "AG Grid 源码审计", link: "/advanced/ag-grid-source-study" },
            { text: "路线图与差距分析", link: "/advanced/roadmap" }
          ]
        }
      ]
    },
    socialLinks: [{ icon: "github", link: "https://github.com/ChenyCHENYU/MachTable" }],
    outline: { level: [2, 3] },
    search: { provider: "local" }
  }
});
