import { test } from "node:test";
import ts from "typescript";
import { declaredRuntimeKeys } from "../../scripts/runtime-key-contract.mjs";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { privatePropertyPattern } from "../../scripts/private-property-mangling.mjs";

test("internal compression preserves native, public, protected and quoted runtime keys", async () => {
  const directory = await mkdtemp(join(tmpdir(), "machtable-mangling-"));
  try {
    await writeFile(join(directory, "fixture.ts"), `
      /** @internal Only internal instances use this implementation. */
      class Owner {
        constructor(private fixtureOwner: unknown) {}
        fixtureRunStage() {}
        fixtureRuntimeLookup() {}
        push() {}
      }
      type LocalContext = Pick<Owner, "fixtureRunStage">;
      const lookup = { "fixtureRuntimeLookup": true };
      export class Public {
        constructor(public fixturePublicParameter: unknown, protected fixtureProtectedParameter: unknown) {}
        fixturePublicMethod() {}
      }
    `);
    const pattern = privatePropertyPattern(pathToFileURL(`${directory}/`));
    for (const key of ["fixtureRunStage", "fixtureOwner"]) assert.equal(pattern.test(key), true, key);
    for (const key of ["fixtureRuntimeLookup", "fixturePublicMethod", "fixturePublicParameter", "fixtureProtectedParameter", "push"])
      assert.equal(pattern.test(key), false, key);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("declaration guard covers mapped literals, quoted members and constructor properties", () => {
  const source = ts.createSourceFile("consumer.d.ts", `
    export type Map = Record<"fixtureMappedKey", unknown>;
    export interface Quoted { "fixtureQuotedKey": unknown }
    export class Public {
      constructor(public fixtureParameter: unknown, protected fixtureProtected: unknown, private fixturePrivate: unknown);
    }
  `, ts.ScriptTarget.Latest, true);
  const keys = declaredRuntimeKeys(source);
  for (const key of ["fixtureMappedKey", "fixtureQuotedKey", "fixtureParameter", "fixtureProtected"]) assert.ok(keys.includes(key), key);
  assert.equal(keys.includes("fixturePrivate"), false);
});
