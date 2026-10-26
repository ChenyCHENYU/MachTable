import { readFile, writeFile } from "node:fs/promises";
import { gzipBudgets, releaseBudgets, optionalReleaseBudget } from "./bundle-budgets.mjs";

const path = new URL("../docs/advanced/performance.md", import.meta.url);
const start = "<!-- bundle-budgets:start -->";
const end = "<!-- bundle-budgets:end -->";
const content = await readFile(path, "utf8");
const generated = [start,
  "<!-- Generated from scripts/bundle-budgets.mjs; run node scripts/check-budget-docs.mjs --write. -->",
  "| 产物 / 真实消费入口 | gzip 上限 |", "| --- | ---: |",
  ...Object.values(gzipBudgets).map(([name, bytes]) => `| ${name} | ${bytes / 1024} KiB (${bytes} bytes) |`),
  "", "| 解压产物图 | 字节上限 |", "| --- | ---: |",
  ...Object.entries(releaseBudgets).map(([name, bytes]) => `| ${name} 原有导出依赖图 | ${bytes} |`),
  `| Core 七个可选能力新增依赖图 | ${optionalReleaseBudget} |`, end
].join("\n");
const pattern = /<!-- bundle-budgets:start -->[\s\S]*?<!-- bundle-budgets:end -->/;
if (!pattern.test(content)) throw new Error("Performance documentation is missing budget markers.");
const expected = content.replace(pattern, generated);
if (process.argv.includes("--write")) await writeFile(path, expected);
else if (content !== expected) {
  console.error("Bundle budget documentation drifted. Run node scripts/check-budget-docs.mjs --write.");
  process.exitCode = 1;
} else console.log("OK bundle budgets and performance documentation share the same byte ceilings");
