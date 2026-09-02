import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git } from "../../src/index.js";
import { matchesGritsError } from "../helpers/grits-error.js";
import { isRuntimeFunction } from "../../src/internal/runtime-type.js";

describe("Grits public API contract", () => {
  it("exposes frozen git commands", () => {
    assert.equal(Object.isFrozen(git), true);
    assert.equal(isRuntimeFunction(git.catBlob), true);
    assert.equal(isRuntimeFunction(git.resolveRev), true);
    assert.equal(isRuntimeFunction(git.isAncestor), true);
  });

  it("rejects a missing memory object through git.catBlob", async () => {
    const read = git.catBlob({
      repository: { kind: "memory", seed: { objects: [], refs: [] } },
      rev: "missing-object",
    });
    assert.equal(read instanceof Promise, true);
    await assert.rejects(read, (error: Error) =>
      matchesGritsError(error, "NOT_FOUND", "objects.read"),
    );
  });

  it("resolves a missing memory ref to an empty string", async () => {
    const resolve = git.resolveRev({
      repository: { kind: "memory", seed: { objects: [], refs: [] } },
      ref: "missing-ref",
    });
    assert.equal(resolve instanceof Promise, true);
    assert.equal(await resolve, "");
  });
});
