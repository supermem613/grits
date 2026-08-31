import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits, GritsError } from "../../src/index.js";

describe("Grits public API contract", () => {
  it("creates a frozen memory repository handle with supported async operations", async () => {
    const grits = createGrits({
      repository: {
        kind: "memory",
        seed: {
          objects: [],
          refs: [],
        },
      },
    });

    assert.equal(grits.capabilities.repository, "memory");
    assert.equal(grits.capabilities.objects.read, "supported");
    assert.equal(grits.capabilities.refs.resolve, "supported");
    assert.equal(grits.capabilities.history.isAncestor, "supported");
    assert.equal(Object.isFrozen(grits), true);
    assert.equal(Object.isFrozen(grits.capabilities), true);
    assert.equal(Object.isFrozen(grits.objects), true);
    assert.equal(Object.isFrozen(grits.refs), true);
    assert.equal(Object.isFrozen(grits.history), true);

    const read = grits.objects.read("missing-object");
    assert.equal(read instanceof Promise, true);
    await assert.rejects(read, (error: unknown) => {
      assert.equal(error instanceof GritsError, true);
      assert.equal((error as GritsError).code, "NOT_FOUND");
      assert.equal((error as GritsError).operation, "objects.read");
      return true;
    });

    const resolve = grits.refs.resolve("missing-ref");
    assert.equal(resolve instanceof Promise, true);
    assert.equal(await resolve, null);
  });

  it("constructs a filesystem repository handle without requiring its path", () => {
    const grits = createGrits({
      repository: {
        kind: "filesystem",
        path: "path-that-does-not-exist",
      },
    });

    assert.equal(grits.capabilities.repository, "filesystem");
    assert.equal(Object.isFrozen(grits), true);
  });
});
