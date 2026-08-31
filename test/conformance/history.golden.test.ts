import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_HISTORY_SLOTS = [
  "history.revParse",
  "history.resolveCommit",
  "history.revListCount",
  "history.countCommits",
  "history.firstCommit",
  "history.lookupBlobAt",
  "history.lookupBlobsAtBatch",
  "history.splitPathRev",
  "history.mergeBase",
  "history.revListObjects",
  "history.objectSizes",
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

function gitIsAncestor(
  repositoryPath: string,
  ancestorId: string,
  descendantId: string,
): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorId, descendantId], {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(result.stderr || "git merge-base --is-ancestor failed");
}

function withOracleRepo<T>(
  run: (repositoryPath: string, firstId: string, secondId: string) => T | Promise<T>,
): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-history-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "history-golden.txt"), "first\n", "utf8");
      gitId(repositoryPath, ["add", "history-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "first"]);
      const firstId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "history-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "history-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, firstId, secondId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("history family goldens", () => {
  for (const slotId of NYI_HISTORY_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath, firstId, secondId) => {
        assert.match(firstId, /^[0-9a-f]{40}$/);
        assert.match(secondId, /^[0-9a-f]{40}$/);
        assert.equal(await invokePalSlot(slotId), secondId);
      });
    });
  }

  it("spawns git then matches history.isAncestor for history.isAncestor", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      const oracleTrue = gitIsAncestor(repositoryPath, firstId, secondId);
      const oracleFalse = gitIsAncestor(repositoryPath, secondId, firstId);
      const grits = createGrits({
        repository: { kind: "filesystem", path: repositoryPath },
      });
      assert.equal(await grits.history.isAncestor(firstId, secondId), oracleTrue);
      assert.equal(await grits.history.isAncestor(secondId, firstId), oracleFalse);
      assert.equal(oracleTrue, true);
      assert.equal(oracleFalse, false);
    });
  });

  it("spawns git then matches refs.resolve for history.resolveRev", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      const oracleId = gitId(repositoryPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        "HEAD",
      ]);
      assert.equal(oracleId, secondId);
      const grits = createGrits({
        repository: { kind: "filesystem", path: repositoryPath },
      });
      const resolved = await grits.refs.resolve("HEAD");
      assert.equal(resolved?.name, "HEAD");
      assert.equal(resolved?.objectId, oracleId);
    });
  });
});
