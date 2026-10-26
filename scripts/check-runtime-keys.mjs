import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { privatePropertyPattern } from "./private-property-mangling.mjs";
import { declaredRuntimeKeys } from "./runtime-key-contract.mjs";

// The generated declarations are the consumer contract, including Column and
// other objects passed to custom renderers. Internal service compression must
// never rename one of these public or protected members.
const pattern = privatePropertyPattern();
const failures = new Set();
let checked = 0;
for (const name of ["core", "vue", "react", "xlsx"]) {
  const directory = join("packages", name, "dist");
  const files = readdirSync(directory).filter(file => /\.d\.(?:ts|cts)$/.test(file));
  if (!files.some(file => file.endsWith(".d.ts")) || !files.some(file => file.endsWith(".d.cts"))) {
    failures.add(`${directory}: full ESM/CJS declarations required; run pnpm build:release`);
  }
  for (const file of files) {
    const path = join(directory, file);
    const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    for (const key of declaredRuntimeKeys(source)) {
      checked++;
      if (pattern.test(key)) failures.add(`${path}: ${key}`);
    }
  }
}
if (failures.size) {
  console.error(`Public runtime keys must not be compressed:\n${[...failures].join("\n")}`);
  process.exitCode = 1;
} else console.log(`OK   ${checked} declared runtime keys retain their public names`);
