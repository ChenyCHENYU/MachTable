import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const matrix = JSON.parse(await readFile(join(root, "tests/compatibility/cases.json"), "utf8"));
const args = process.argv.slice(2);
let selected, reportFile = join(root, "node_modules/.cache/framework-compatibility.json");
for (let index = 0; index < args.length; index++) {
  const option = args[index];
  if (option === "--list") {
    console.log(JSON.stringify(matrix, null, 2));
    process.exit(0);
  }
  if (option === "--case" || option === "--report") {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${option}`);
    if (option === "--case") selected = value;
    else reportFile = resolve(value);
  }
  else throw new Error(`Unknown option: ${option}`);
}
const cases = matrix.cases.filter(item => selected === undefined || item.id === selected);
if (!cases.length) throw new Error(`Unknown compatibility case: ${selected}`);
if (matrix.cases.some(item => !["vue", "react"].includes(item.framework) || !/^\d+\.\d+\.\d+$/.test(item.version))) {
  throw new Error("Compatibility cases must use a known framework and exact stable version.");
}
if (!Array.isArray(matrix.typescript) || !matrix.typescript.length ||
    matrix.typescript.some(version => !/^\d+\.\d+\.\d+$/.test(version)) || !/^\d+\.\d+\.\d+$/.test(matrix.vueTsc)) {
  throw new Error("The type compatibility matrix requires exact TypeScript and vue-tsc versions.");
}
if (process.platform === "win32") throw new Error("Run the isolated compatibility runner in Linux CI or WSL; it never launches a browser.");

/** Commands are fixed; arguments never enter a shell. Each install has its own consumer and config. */
function run(command, arguments_, cwd, env = process.env) {
  const result = spawnSync(command, arguments_, { cwd, env, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed (${result.status ?? result.error?.code}):\n${(result.stderr || result.stdout || result.error?.message).slice(-12_000)}`);
  }
  return result.stdout;
}

/** Hash path and bytes, not timestamps; consumers must contain the exact built distribution. */
async function distDigest(directory) {
  const hash = createHash("sha256");
  let count = 0;
  async function visit(relative) {
    const entries = await readdir(join(directory, relative), { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(name);
      else {
        const data = await readFile(join(directory, name));
        hash.update(`${name}\0${data.byteLength}\0`).update(data);
        count++;
      }
    }
  }
  await visit("");
  return { sha256: hash.digest("hex"), files: count };
}
/** Fixed type versions are part of the checked matrix, not whatever npm currently resolves. */
function typeDependencies(item, version) {
  if (item.framework === "vue") return { typescript: version, "vue-tsc": matrix.vueTsc, "@vue/compiler-sfc": item.version };
  const types = matrix.reactTypes[item.version.split(".")[0]];
  if (!types) throw new Error(`Missing matching React types for ${item.version}`);
  return { typescript: version, "@types/react": types.react, "@types/react-dom": types.reactDom };
}

/** Real installed-package checking: no workspace paths and no skipped library declarations. */
async function checkTypes(consumer, item, version, env) {
  for (const [name, expected] of Object.entries(typeDependencies(item, version))) {
    const actual = JSON.parse(await readFile(join(consumer, "node_modules", name, "package.json"), "utf8")).version;
    if (actual !== expected) throw new Error(`Expected ${name}@${expected}, received ${actual}`);
  }
  const files = ["core.ts", "optional-core.ts", `${item.framework}.${item.framework === "vue" ? "ts" : "tsx"}`, `optional-${item.framework}.ts`];
  if (item.framework === "vue") files.push("vue-editors.ts");
  for (const file of files) await cp(join(root, "tests/consumer", file), join(consumer, file));
  if (item.framework === "vue") {
    await cp(join(root, "tests/consumer/vue-sfc/App.vue"), join(consumer, "App.vue"));
    files.push("App.vue");
  }
  const esm = [], cjs = [];
  let index = 0;
  for (const name of ["@agile-team/mach-table", `@agile-team/mach-table-${item.framework}`]) {
    const manifest = JSON.parse(await readFile(join(consumer, "node_modules", name, "package.json"), "utf8"));
    for (const key of Object.keys(manifest.exports)) {
      const specifier = name + (key === "." ? "" : key.slice(1));
      if (key.includes(".css")) esm.push(`import ${JSON.stringify(specifier)};`);
      else {
        esm.push(`import * as entry${index} from ${JSON.stringify(specifier)}; export const use${index} = entry${index};`);
        cjs.push(`import entry${index} = require(${JSON.stringify(specifier)}); export const use${index} = entry${index};`);
        index++;
      }
    }
  }
  await writeFile(join(consumer, "all-exports.ts"), esm.join("\n"));
  await writeFile(join(consumer, "all-exports.cts"), cjs.join("\n"));
  files.push("all-exports.ts");
  const options = { target: "ES2020", lib: ["ES2020", "DOM", "DOM.Iterable"], strict: true, skipLibCheck: false,
    types: [], esModuleInterop: true, noEmit: true, jsx: "react-jsx" };
  await writeFile(join(consumer, "tsconfig.types.json"), JSON.stringify({ compilerOptions: { ...options,
    module: "ESNext", moduleResolution: "bundler", noUncheckedSideEffectImports: true }, files }));
  await writeFile(join(consumer, "tsconfig.cts.json"), JSON.stringify({ compilerOptions: { ...options,
    module: "NodeNext", moduleResolution: "NodeNext" }, files: ["all-exports.cts"] }));
  // Also consume the package from a library that publishes its own declarations.
  // noEmit alone cannot detect unnamed external types leaking into inferred exports.
  const declarationDirectory = `consumer-declarations-${version}`;
  await writeFile(join(consumer, "tsconfig.types-emit.json"), JSON.stringify({ compilerOptions: { ...options,
    module: "ESNext", moduleResolution: "bundler", noUncheckedSideEffectImports: true,
    noEmit: false, declaration: true, emitDeclarationOnly: true, outDir: declarationDirectory }, files }));
  const invoke = (tool, config) => {
    const command = spawnSync(process.execPath, [tool, "--pretty", "false", "--project", config],
      { cwd: consumer, env, encoding: "utf8", timeout: 300_000, maxBuffer: 4 * 1024 * 1024 });
    if (command.error) throw command.error;
    return { exitCode: command.status, output: (command.stdout + command.stderr).trim() };
  };
  const tsc = "node_modules/typescript/bin/tsc", vueTsc = "node_modules/vue-tsc/bin/vue-tsc.js";
  const result = { typescript: version, strict: true, skipLibCheck: false, publicCodeEntries: index,
    dependencies: typeDependencies(item, version), esm: invoke(item.framework === "vue" ? vueTsc : tsc, "tsconfig.types.json"),
    cjs: invoke(tsc, "tsconfig.cts.json"),
    esmEmit: invoke(item.framework === "vue" ? vueTsc : tsc, "tsconfig.types-emit.json") };
  const pureVueError = /^node_modules\/@vue\/runtime-core\/dist\/runtime-core\.d\.ts\(1799,33\): error TS2344: Type 'HostElement' does not satisfy the constraint 'RendererElement'\.$/;
  if (item.framework === "vue" && item.version === "3.2.0") {
    await writeFile(join(consumer, "vue-only.ts"), 'import { defineComponent, ref } from "vue"; export const component = defineComponent({ setup() { return { count: ref(0) }; } });');
    await writeFile(join(consumer, "tsconfig.vue-only.json"), JSON.stringify({ compilerOptions: { ...options,
      module: "ESNext", moduleResolution: "bundler" }, files: ["vue-only.ts"] }));
    result.upstreamBaseline = invoke(tsc, "tsconfig.vue-only.json");
    if (result.upstreamBaseline.exitCode === 0 || !pureVueError.test(result.upstreamBaseline.output) ||
      result.esm.output !== result.upstreamBaseline.output || result.cjs.output !== result.upstreamBaseline.output ||
      result.esmEmit.output !== result.upstreamBaseline.output) {
      throw new Error(`Vue 3.2.0 declaration regression beyond the exact upstream-only baseline:\n${JSON.stringify(result, null, 2)}`);
    }
    result.fullDeclarationsPassed = false;
    result.ownDeclarationsPassed = true;
  } else {
    if (result.esm.exitCode !== 0 || result.cjs.exitCode !== 0 || result.esmEmit.exitCode !== 0) throw new Error(`Type consumer failed:\n${JSON.stringify(result, null, 2)}`);
    result.fullDeclarationsPassed = result.ownDeclarationsPassed = true;
  }
  result.consumerDeclarationFiles = (await readdir(join(consumer, declarationDirectory), { recursive: true }))
    .filter(file => file.endsWith(".d.ts"));
  for (const file of files) {
    const expected = /\.tsx?$/.test(file) ? file.replace(/\.tsx?$/, ".d.ts") : `${file}.d.ts`;
    if (!result.consumerDeclarationFiles.includes(expected)) throw new Error(`Missing emitted consumer declaration: ${expected}`);
  }
  // A negative prop case proves that SFC/TSX props are checked, not merely parsed.
  const extension = item.framework === "vue" ? "vue" : "tsx", negative = `bad-case.${extension}`;
  await writeFile(join(consumer, negative), item.framework === "vue"
    ? '<script setup lang="ts">import { MachTable } from "@agile-team/mach-table-vue";</script>\n<template><MachTable :row-data="42" /></template>\n'
    : 'import { MachTable } from "@agile-team/mach-table-react"; interface Row { id: string; amount: number } export const invalid = <MachTable<Row> rowKey="id" columnDefs={[{ field: "amount" }]} rowData={[{id: "r1", amount: "invalid"}]} />;\n');
  await writeFile(join(consumer, "tsconfig.negative.json"), JSON.stringify({ compilerOptions: { ...options,
    module: "ESNext", moduleResolution: "bundler" }, files: [negative] }));
  result.negative = invoke(item.framework === "vue" ? vueTsc : tsc, "tsconfig.negative.json");
  const lines = result.negative.output.split("\n").filter(Boolean);
  if (result.negative.exitCode === 0 || !lines.some(line => line.startsWith(negative + "(") && line.includes("error TS2322:")) ||
    lines.some(line => !line.startsWith(negative + "(") && !pureVueError.test(line))) {
    throw new Error(`Negative ${item.framework} prop check did not fail as expected:\n${JSON.stringify(result.negative)}`);
  }
  return result;
}

const temporary = await mkdtemp(join(tmpdir(), "machtable-framework-"));
const report = {
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  matrixCheckedOn: matrix.checkedOn, registry: matrix.registry,
  scope: "Packed ESM runtime lifecycle/API in jsdom plus real SFC/TSX and ESM/CJS declaration consumers. No CSS/layout/browser or full peer-range claim.",
  artifacts: {}, cases: []
};
try {
  const artifactsDirectory = join(temporary, "artifacts");
  await mkdir(artifactsDirectory);
  for (const name of ["core", ...new Set(cases.map(item => item.framework))]) {
    const directory = join(root, "packages", name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const digest = await distDigest(join(directory, "dist"));
    // pnpm resolves workspace:* exactly as in an official release; npm pack does not.
    run("pnpm", ["--dir", directory, "pack", "--pack-destination", artifactsDirectory], root);
    const tarball = join(artifactsDirectory, `${manifest.name.replace(/^@/, "").replace("/", "-")}-${manifest.version}.tgz`);
    report.artifacts[name] = { name: manifest.name, version: manifest.version, dist: digest,
      tarballSha512: createHash("sha512").update(await readFile(tarball)).digest("hex") };
    report.artifacts[name].tarball = tarball;
  }
  // Public metadata installs must not inherit a developer's registry credentials/config.
  const npmEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:npm_config_|npm_token$|node_auth_token$)/i.test(key)));
  const userConfig = join(temporary, "user.npmrc"), globalConfig = join(temporary, "global.npmrc");
  await Promise.all([writeFile(userConfig, ""), writeFile(globalConfig, "")]);
  Object.assign(npmEnvironment, { npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig,
    npm_config_cache: join(temporary, "npm-cache"), NODE_ENV: "development" });
  for (const item of cases) {
    const started = Date.now(), result = { ...item, status: "failed" };
    report.cases.push(result);
    try {
      const consumer = join(temporary, item.id);
      await mkdir(consumer);
      const artifacts = [report.artifacts.core, report.artifacts[item.framework]];
      const dependencies = Object.fromEntries(artifacts.map(artifact => [artifact.name, `file:${artifact.tarball}`]));
      Object.assign(dependencies, { jsdom: matrix.jsdom, [item.framework]: item.version });
      if (item.framework === "react") dependencies["react-dom"] = item.version;
      Object.assign(dependencies, typeDependencies(item, matrix.typescript[0]));
      await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }));
      await cp(join(root, "tests/compatibility/mount.mjs"), join(consumer, "mount.mjs"));
      run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry", matrix.registry,
        "--fetch-retries=1", "--fetch-timeout=30000"], consumer, npmEnvironment);
      for (const artifact of artifacts) {
        const installed = join(consumer, "node_modules", artifact.name);
        const installedManifest = JSON.parse(await readFile(join(installed, "package.json"), "utf8"));
        if (installedManifest.version !== artifact.version) throw new Error(`Wrong installed ${artifact.name} version`);
        const installedDigest = await distDigest(join(installed, "dist"));
        if (JSON.stringify(installedDigest) !== JSON.stringify(artifact.dist)) throw new Error(`Distribution mismatch: ${artifact.name}`);
      }
      for (const dependency of [item.framework, ...(item.framework === "react" ? ["react-dom"] : [])]) {
        const installed = JSON.parse(await readFile(join(consumer, "node_modules", dependency, "package.json"), "utf8"));
        if (installed.version !== item.version) throw new Error(`Expected ${dependency}@${item.version}, received ${installed.version}`);
      }
      const output = run(process.execPath, ["mount.mjs", item.framework], consumer, npmEnvironment);
      const line = output.split("\n").find(value => value.startsWith("MACHTABLE_COMPAT_RESULT "));
      if (!line) throw new Error(`Consumer did not produce a result: ${output.slice(-2000)}`);
      const runtimeResult = JSON.parse(line.slice("MACHTABLE_COMPAT_RESULT ".length));
      if (runtimeResult.actualVersion !== (item.runtimeVersion ?? item.version)) throw new Error(`Wrong loaded framework: ${runtimeResult.actualVersion}`);
      const typeResults = [];
      for (const version of matrix.typescript) {
        if (version !== matrix.typescript[0]) {
          dependencies.typescript = version;
          await writeFile(join(consumer, "package.json"), JSON.stringify({ private: true, type: "module", dependencies }));
          run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", "--registry", matrix.registry,
            "--fetch-retries=1", "--fetch-timeout=30000"], consumer, npmEnvironment);
        }
        typeResults.push(await checkTypes(consumer, item, version, npmEnvironment));
      }
      Object.assign(result, { status: "passed", ...runtimeResult, types: typeResults });
      console.log(`OK   ${item.id}: ${item.framework}@${item.version}`);
      if (typeResults.some(type => !type.fullDeclarationsPassed)) {
        console.log("NOTE Vue 3.2.0 has its independently reproduced upstream declaration error; own declarations passed. See the report.");
      }
    } catch (error) {
      result.error = error.message;
      console.error(`FAIL ${item.id}: ${result.error}`);
      process.exitCode = 1;
    } finally { result.elapsedMs = Date.now() - started; }
  }
} catch (error) {
  report.setupError = error.message;
  process.exitCode = 1;
  console.error(error.message);
} finally {
  // The persisted evidence includes hashes, not temporary paths that no longer exist.
  for (const artifact of Object.values(report.artifacts)) delete artifact.tarball;
  report.finishedAt = new Date().toISOString();
  try {
    await mkdir(dirname(reportFile), { recursive: true });
    await writeFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  } finally { await rm(temporary, { recursive: true, force: true }); }
  console.log(`Compatibility evidence: ${reportFile}`);
}
