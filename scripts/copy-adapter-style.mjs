import { copyFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const adapter = process.argv[2];
const supportedAdapters = new Set(["vue", "react"]);

if (!supportedAdapters.has(adapter)) {
  throw new Error(`Expected an adapter name (${[...supportedAdapters].join(" or ")}), received: ${adapter ?? "none"}`);
}

const workspaceRoot = new URL("../", import.meta.url);
const outputDirectory = new URL(`packages/${adapter}/dist/`, workspaceRoot);

await mkdir(fileURLToPath(outputDirectory), { recursive: true });
await Promise.all(["mach-table", "workbench", "server-side"].flatMap(name => ["css", "css.d.ts"].map(extension =>
  copyFile(new URL(`packages/core/dist/${name}.${extension}`, workspaceRoot), new URL(`${name}.${extension}`, outputDirectory))
)));

console.log(`Copied the MachTable stylesheet into the ${adapter} adapter package.`);
