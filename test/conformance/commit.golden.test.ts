import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { GritsError } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_COMMIT_SLOTS = [
  "commit.commitTree",
  "commit.lsTreeNameOnly",
  "commit.lsTreeNameOnlyZ",
  "commit.lsTreeRecursiveZ",
  "commit.lsTreePath",
  "commit.lsTreeInfoZ",
  "commit.mktree",
  "commit.show",
  "commit.logFormat",
  "commit.revListParents",
  "commit.catFileType",
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

function withOracleRepo<T>(run: (repositoryPath: string) => T | Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-commit-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "commit-golden.txt"), "golden-commit\n", "utf8");
      gitId(repositoryPath, ["add", "commit-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-commit"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("commit family goldens", () => {
  for (const slotId of NYI_COMMIT_SLOTS) {
    it(`spawns git then rejects ${slotId} as NYI`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
        assert.match(headId, /^[0-9a-f]{40}$/);
        const objectType = gitId(repositoryPath, ["cat-file", "-t", headId]);
        assert.equal(objectType, "commit");
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
