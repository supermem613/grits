import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git, type Git } from "../../src/index.js";
import { palSlotIds } from "../../src/conformance/pal-surface-registry.js";
import { matchesGritsError } from "../helpers/grits-error.js";
import {
  isRuntimeFunction,
  isRuntimeString,
} from "../../src/internal/runtime-type.js";

describe("public git export", () => {
  it("exports a frozen git bag with a function for every command", () => {
    assert.equal(Object.isFrozen(git), true);
    assert.equal(isRuntimeFunction(git.hashObjectNoWrite), true);
    assert.equal(isRuntimeFunction(git.clone), true);
    for (const slotId of palSlotIds) {
      const member = slotId.split(".")[1];
      assert.equal(isRuntimeString(member), true);
      if (!isRuntimeString(member)) {
        throw new Error(`slot ${slotId} is not family.member`);
      }
      // SAFETY: public git keys are unique member names, including repo aliases of bootstrap.
      assert.equal(isRuntimeFunction(git[member as keyof Git]), true);
    }
  });

  it("hashes stdin through git.hashObjectNoWrite", async () => {
    const objectId = await git.hashObjectNoWrite({ stdin: "hello\n" });
    assert.equal(/^[0-9a-f]{40}$/.test(objectId), true);
  });

  it("reads a memory blob through the memory PAL", async () => {
    const objectId = await git.hashObjectNoWrite({ stdin: "hello\n" });
    const payload = await git.catBlob({
      repository: {
        kind: "memory",
        seed: {
          objects: [
            {
              kind: "blob",
              id: objectId,
              bytes: Array.from(Buffer.from("hello\n")),
            },
          ],
        },
      },
      rev: objectId,
    });
    assert.equal(payload, "hello\n");
  });

  it("rejects clone on a memory repository", async () => {
    await assert.rejects(
      git.clone({ repository: { kind: "memory" }, path: "source", dest: "dest" }),
      (error: Error) => matchesGritsError(error, "UNSUPPORTED_CAPABILITY", "bootstrap.clone"),
    );
  });
});
