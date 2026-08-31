import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { GritsError } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_BLAME_SLOTS = ["blame.porcelain", "blame.revPath"] as const;

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

function withOracleRepo<T>(run: (repositoryPath: string, commitId: string) => T | Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-blame-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "blame-golden.txt"), "golden-blame\n", "utf8");
      gitId(repositoryPath, ["add", "blame-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-blame"]);
      const commitId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, commitId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("blame family goldens", () => {
  for (const slotId of NYI_BLAME_SLOTS) {
    it(`spawns git then rejects ${slotId} as NYI`, async () => {
      await withOracleRepo(async (repositoryPath, commitId) => {
        const porcelain = git(repositoryPath, ["blame", "--porcelain", "blame-golden.txt"]);
        assert.match(porcelain, new RegExp(`^${commitId} `));
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
