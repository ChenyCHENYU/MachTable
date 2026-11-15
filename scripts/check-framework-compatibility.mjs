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

const temporary = await mkdtemp(join(tmpdir(), "machtable-framework-"));
const report = {
  startedAt: new Date().toISOString(), node: process.version, platform: process.platform,
  matrixCheckedOn: matrix.checkedOn, registry: matrix.registry,
  scope: "Packed ESM framework components and workflows in jsdom; lifecycle/API smoke only, no CSS/layout/browser or full peer-range claim.",
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
      Object.assign(result, { status: "passed", ...runtimeResult });
      console.log(`OK   ${item.id}: ${item.framework}@${item.version}`);
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
