import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { GritsError } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_MERGE_SLOTS = [
  "merge.mergeFfOnly",
  "merge.rebaseOnto",
  "merge.rebaseAbort",
] as const;

function git(repositoryPath: string, args: readonly string[], stdin?: string): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
    input: stdin,
  });
}

function gitId(repositoryPath: string, args: readonly string[], stdin?: string): string {
  return git(repositoryPath, args, stdin).trim();
}

function withOracleRepo<T>(
  run: (repositoryPath: string, firstId: string, secondId: string) => T | Promise<T>,
): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-merge-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "merge-golden.txt"), "first\n", "utf8");
      gitId(repositoryPath, ["add", "merge-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "first"]);
      const firstId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "merge-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "merge-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, firstId, secondId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("merge family goldens", () => {
  for (const slotId of NYI_MERGE_SLOTS) {
    it(`spawns git then rejects ${slotId} as NYI`, async () => {
      await withOracleRepo(async (repositoryPath, firstId, secondId) => {
        const mergeBase = gitId(repositoryPath, ["merge-base", firstId, secondId]);
        assert.equal(mergeBase, firstId);
        await assert.rejects(
          () => invokePalSlot(slotId),
          (error: unknown) => {
            assert.equal(error instanceof GritsError, true);
            assert.equal((error as GritsError).code, "UNSUPPORTED_CAPABILITY");
            assert.equal((error as GritsError).operation, slotId);
            return true;
          },
        );
      });
    });
  }
});
