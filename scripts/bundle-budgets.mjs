/** Byte ceilings are shared by CI and generated documentation. Raising one is a product decision. */
export const gzipBudgets = {
  core: ["Core ESM", 90 * 1024],
  worker: ["Optional Worker", 8 * 1024],
  vue: ["Vue ESM artifacts", 11.25 * 1024],
  react: ["React ESM artifacts", 8 * 1024],
  xlsx: ["Optional XLSX bridge", 3 * 1024],
  css: ["Core CSS", 8 * 1024],
  workbench: ["Optional workbench", 12 * 1024],
  preferences: ["Optional preferences", 7 * 1024],
  ordering: ["Optional ordering", 9 * 1024],
  "server-side": ["Optional server-side", 10 * 1024],
  analysis: ["Optional analysis", 9 * 1024],
  "multi-range": ["Optional multi-range", 4 * 1024],
  import: ["Optional import planning", 4 * 1024],
  workbenchCss: ["Workbench CSS", 3 * 1024],
  serverCss: ["Server-side CSS", 1024],
  coreConsumer: ["Core createGrid consumer", 80.5 * 1024],
  vueConsumer: ["Vue initial adapter", 6.75 * 1024],
  vueWorkflows: ["Vue B-side workflows", 5 * 1024],
  vueEditors: ["Vue optional editors", 3 * 1024],
  vueUi: ["Vue optional UI", 3 * 1024],
  reactConsumer: ["React initial adapter", 6.25 * 1024],
  reactWorkflows: ["React B-side workflows", 5 * 1024]
};

export const releaseBudgets = { core: 1_050_000, vue: 450_000, react: 350_000, xlsx: 80_000 };
export const optionalReleaseBudget = 350_000;
