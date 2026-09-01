import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_INDEX_SLOTS = [
  "index.readTree",
  "index.updateIndexCacheinfo",
  "index.updateIndexForceRemove",
  "index.updateIndexForceRemovePathspec",
  "index.updateIndexInfo",
  "index.writeTree",
  "index.statusPorcelain",
  "index.statusFull",
  "index.statusFullScoped",
  "index.stagedNames",
  "index.statusFullWithIgnored",
  "index.statusBranch",
  "index.statusBranchStream",
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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-index-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "index-golden.txt"), "golden-index\n", "utf8");
      gitId(repositoryPath, ["add", "index-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-index"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("index family goldens", () => {
  for (const slotId of NYI_INDEX_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const status = git(repositoryPath, ["status", "--porcelain"]);
        assert.equal(status, "");
        const treeId = gitId(repositoryPath, ["write-tree"]);
        assert.match(treeId, /^[0-9a-f]{40}$/);
        assert.equal(await invokePalSlot(slotId, { repositoryPath }), treeId);
      });
    });
  }
});
