import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ESLint } from "eslint";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const baselinePath = fileURLToPath(new URL("./quality/complexity-baseline.json", import.meta.url));
const baseline = JSON.parse(await readFile(baselinePath, "utf8"));
const limit = baseline.maxNewComplexity;
const eslint = new ESLint({
  cwd: root,
  overrideConfig: {
    rules: {
      complexity: ["error", { max: limit, variant: "classic" }]
    }
  }
});

const results = await eslint.lintFiles(["packages/*/src/**/*.{ts,tsx}"]);
const current = new Map();

for (const result of results) {
  const relativeFile = path.relative(root, result.filePath).replaceAll(path.sep, "/");
  if (relativeFile.includes("/__tests__/") || relativeFile.endsWith(".test.ts")) continue;
  for (const message of result.messages) {
    if (message.ruleId !== "complexity") continue;
    const match = /^(.+) has a complexity of (\d+)\./.exec(message.message);
    if (!match) continue;
    const key = `${relativeFile}::${match[1]}`;
    const values = current.get(key) ?? [];
    values.push(Number(match[2]));
    current.set(key, values);
  }
}

const failures = [];
let trackedFunctions = 0;
let improvedFunctions = 0;

for (const [key, values] of current) {
  const allowed = baseline.allowances[key];
  const actual = [...values].sort((left, right) => right - left);
  if (!allowed) {
    failures.push(`${key}: new complexity debt ${actual.join(", ")} (limit ${limit})`);
    continue;
  }
  const ceilings = [...allowed].sort((left, right) => right - left);
  trackedFunctions += actual.length;
  if (actual.length > ceilings.length) {
    failures.push(`${key}: ${actual.length} functions exceed the limit; baseline allows ${ceilings.length}`);
    continue;
  }
  for (let index = 0; index < actual.length; index++) {
    if (actual[index] > ceilings[index]) {
      failures.push(`${key}: complexity ${actual[index]} exceeds baseline ${ceilings[index]}`);
    } else if (actual[index] < ceilings[index]) {
      improvedFunctions++;
    }
  }
}

for (const [key, ceilings] of Object.entries(baseline.allowances)) {
  const actualCount = current.get(key)?.length ?? 0;
  if (actualCount < ceilings.length) improvedFunctions += ceilings.length - actualCount;
}

if (failures.length > 0) {
  console.error(`Complexity gate failed with ${failures.length} regression(s):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  const improvement = improvedFunctions > 0 ? `; ${improvedFunctions} baseline item(s) improved` : "";
  console.log(`Complexity gate passed: new code <= ${limit}, ${trackedFunctions} tracked debt item(s) did not regress${improvement}.`);
}
