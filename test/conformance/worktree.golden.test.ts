import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

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
  it("checkout restores a dirty file without detaching HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const branch = gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      writeFileSync(join(repositoryPath, "worktree-golden.txt"), "dirty\n", "utf8");
      assert.equal(
        await invokePalSlot("worktree.checkout", { repositoryPath, target: "HEAD" }),
        "",
      );
      assert.equal(readFileSync(join(repositoryPath, "worktree-golden.txt"), "utf8"), "golden-worktree\n");
      assert.equal(gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]), branch);
      assert.notEqual(branch, "HEAD");
    });
  });

  it("resetHard restores a dirty file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "worktree-golden.txt"), "dirty\n", "utf8");
      assert.equal(
        await invokePalSlot("worktree.resetHard", { repositoryPath, rev: "HEAD" }),
        "",
      );
      assert.equal(
        git(repositoryPath, ["status", "--porcelain"]),
        "",
      );
    });
  });

  it("checkoutDetach detaches HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("worktree.checkoutDetach", { repositoryPath, target: headId }),
        "",
      );
      assert.equal(gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
    });
  });

  it("checkoutPath restores one file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "worktree-golden.txt"), "dirty\n", "utf8");
      assert.equal(
        await invokePalSlot("worktree.checkoutPath", {
          repositoryPath,
          rev: "HEAD",
          path: "worktree-golden.txt",
        }),
        "",
      );
      assert.equal(
        readFileSync(join(repositoryPath, "worktree-golden.txt"), "utf8"),
        "golden-worktree\n",
      );
    });
  });

  it("prune succeeds with no extra worktrees", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(await invokePalSlot("worktree.prune", { repositoryPath }), "");
    });
  });

  for (const slotId of [
    "worktree.addDetach",
    "worktree.addNoCheckout",
    "worktree.sparseCheckoutInitCone",
    "worktree.sparseCheckoutSet",
    "worktree.removeForce",
    "worktree.move",
  ] as const) {
    it(`${slotId} stays NYI`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        await assert.rejects(
          () => invokePalSlot(slotId, { repositoryPath }),
          (error: Error & { code?: string }) => error.code === "NYI",
        );
      });
    });
  }
});
