import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_WORKTREE_SLOTS = [
  "worktree.checkout",
  "worktree.checkoutDetach",
  "worktree.checkoutPath",
  "worktree.resetHard",
  "worktree.addDetach",
  "worktree.addNoCheckout",
  "worktree.sparseCheckoutInitCone",
  "worktree.sparseCheckoutSet",
  "worktree.removeForce",
  "worktree.move",
  "worktree.prune",
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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-worktree-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "worktree-golden.txt"), "golden-worktree\n", "utf8");
      gitId(repositoryPath, ["add", "worktree-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-worktree"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("worktree family goldens", () => {
  for (const slotId of NYI_WORKTREE_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const worktreeList = git(repositoryPath, ["worktree", "list", "--porcelain"]);
        assert.match(worktreeList, /^worktree /);
        assert.equal(await invokePalSlot(slotId, { repositoryPath }), worktreeList);
      });
    });
  }
});
