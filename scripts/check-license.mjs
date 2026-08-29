import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const packageDirectories = ["packages/core", "packages/vue", "packages/react"];
const expectedMetadata = "SEE LICENSE IN LICENSE";
const expectedTitle = "MachTable Source-Available License 1.0";
const failures = [];

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const rootPackage = readJson("package.json");
const rootLicense = read("LICENSE");
const normalizedRootLicense = rootLicense.replace(/\s+/g, " ");

if (rootPackage.license !== expectedMetadata) {
  failures.push(`package.json license must be ${JSON.stringify(expectedMetadata)}`);
}
if (!rootLicense.startsWith(expectedTitle)) {
  failures.push(`LICENSE must start with ${JSON.stringify(expectedTitle)}`);
}
for (const phrase of ["prior written authorization", "not open-source software", "All rights reserved"]) {
  if (!normalizedRootLicense.toLowerCase().includes(phrase.toLowerCase())) {
    failures.push(`LICENSE is missing required phrase: ${JSON.stringify(phrase)}`);
  }
}

for (const directory of packageDirectories) {
  const manifestPath = `${directory}/package.json`;
  const licensePath = `${directory}/LICENSE`;
  const manifest = readJson(manifestPath);

  if (manifest.version !== rootPackage.version) {
    failures.push(`${manifestPath} version ${manifest.version} does not match root ${rootPackage.version}`);
  }
  if (manifest.license !== expectedMetadata) {
    failures.push(`${manifestPath} license must be ${JSON.stringify(expectedMetadata)}`);
  }
  if (!existsSync(resolve(root, licensePath))) {
    failures.push(`${licensePath} is required so the published tarball carries its license`);
    continue;
  }
  const packageLicense = read(licensePath);
  if (packageLicense !== rootLicense) {
    failures.push(`${licensePath} must exactly match the root LICENSE`);
  }
}

const surfaces = [
  ["README.md", /license-MIT|\[MIT\]\(\.\/LICENSE\)/i],
  ["docs/README.md", /MIT Licensed/i],
  ["docs/guide/overview.md", /\| 许可 \| MIT \|/i],
  ["packages/core/README.md", /^MIT ©/im],
  ["packages/vue/README.md", /^MIT ©/im],
  ["packages/react/README.md", /^MIT ©/im]
];

for (const [relativePath, forbidden] of surfaces) {
  if (forbidden.test(read(relativePath))) {
    failures.push(`${relativePath} still contains a current MIT license claim`);
  }
}

if (failures.length > 0) {
  console.error("License consistency check failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`License metadata is consistent for MachTable ${rootPackage.version} and all published packages.`);
