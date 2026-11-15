import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncWorkspaceVersion } from "../../scripts/version-packages.mjs";

function fixture(t, versions = ["1.0.0", "1.0.0", "1.0.0", "1.0.0"]) {
  const root = mkdtempSync(join(tmpdir(), "machtable-version-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "mach-table", private: true, version: "0.42.0", scripts: { build: "keep" } }, null, 2) + "\n");
  ["core", "vue", "react", "xlsx"].forEach((name, index) => {
    mkdirSync(join(root, "packages", name), { recursive: true });
    writeFileSync(join(root, "packages", name, "package.json"), JSON.stringify({ version: versions[index] }));
  });
  return root;
}

test("synchronizes a fixed major release without changing root fields and is idempotent", t => {
  const root = fixture(t);
  assert.equal(syncWorkspaceVersion(root), true);
  assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), {
    name: "mach-table", private: true, version: "1.0.0", scripts: { build: "keep" }
  });
  assert.equal(syncWorkspaceVersion(root), false);
});

test("rejects a partial release before writing the root", t => {
  const root = fixture(t, ["1.0.0", "1.0.0", "0.42.0", "1.0.0"]);
  const before = readFileSync(join(root, "package.json"), "utf8");
  assert.throws(() => syncWorkspaceVersion(root), /four fixed/);
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
});

test("does not mutate the root when a fixed package is missing", t => {
  const root = fixture(t);
  rmSync(join(root, "packages", "xlsx", "package.json"));
  const before = readFileSync(join(root, "package.json"), "utf8");
  assert.throws(() => syncWorkspaceVersion(root), /ENOENT/);
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
});

test("refuses to repurpose a non-private package as the workspace root", t => {
  const root = fixture(t);
  writeFileSync(join(root, "package.json"), JSON.stringify({ private: false, version: "0.42.0" }));
  const before = readFileSync(join(root, "package.json"), "utf8");
  assert.throws(() => syncWorkspaceVersion(root), /private/);
  assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
});
