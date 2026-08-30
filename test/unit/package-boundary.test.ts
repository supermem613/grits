import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGrits } from "grits";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  exports?: {
    ".": {
      types?: string;
      import?: string;
    };
  };
  types?: string;
  bin?: {
    grits?: string;
  };
};

test("package declaration exposes the built Grits root", () => {
  assert.deepEqual(packageJson.exports?.["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.equal(packageJson.bin?.grits, "./dist/cli.js");
});

test("package-name import exposes createGrits", () => {
  assert.equal(typeof createGrits, "function");
  assert.equal(
    createGrits({ repository: { kind: "memory" } }).capabilities.repository,
    "memory",
  );
});
