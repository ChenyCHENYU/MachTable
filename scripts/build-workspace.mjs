import { spawn } from "node:child_process";

const mode = process.argv[2] ?? "development";
const isWindows = process.platform === "win32";
const command = isWindows ? "pnpm --filter \"./packages/*\" run build" : "pnpm";
const env = { ...process.env };

if (mode === "runtime") env.MACH_TABLE_DTS = "false";
if (mode === "release") env.MACH_TABLE_SOURCEMAP = "false";

const child = spawn(command, isWindows ? [] : ["--filter", "./packages/*", "run", "build"], {
  stdio: "inherit",
  env,
  shell: isWindows
});

child.on("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
