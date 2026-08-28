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
await Promise.all([
  copyFile(
    fileURLToPath(new URL("packages/core/styles/mach-table.css", workspaceRoot)),
    fileURLToPath(new URL("mach-table.css", outputDirectory))
  ),
  copyFile(
    fileURLToPath(new URL("packages/core/styles/mach-table.css.d.ts", workspaceRoot)),
    fileURLToPath(new URL("mach-table.css.d.ts", outputDirectory))
  )
]);

console.log(`Copied the MachTable stylesheet into the ${adapter} adapter package.`);
