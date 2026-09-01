import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGrits } from "grits";
import { isPlainObject, isRuntimeFunction } from "../../src/internal/runtime-type.js";

const parsedPackage = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
);
if (!isPlainObject(parsedPackage)) {
  throw new Error("package.json is not an object");
}
const packageJson = parsedPackage;

test("package declaration exposes the built Grits root", () => {
  assert.deepEqual(packageJson.exports?.["."], {
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.equal(packageJson.types, "./dist/index.d.ts");
});

test("package-name import exposes createGrits", () => {
  assert.equal(isRuntimeFunction(createGrits), true);
  assert.equal(
    createGrits({ repository: { kind: "memory" } }).capabilities.repository,
    "memory",
  );
});
