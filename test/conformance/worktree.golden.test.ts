import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
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

  it("addDetach creates a detached linked worktree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-wt-add-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        assert.equal(
          await invokePalSlot("worktree.addDetach", {
            repositoryPath,
            dest,
            target: "HEAD",
          }),
          "",
        );
        assert.equal(readFileSync(join(dest, "worktree-golden.txt"), "utf8"), "golden-worktree\n");
        assert.equal(gitId(dest, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
        const listed = git(repositoryPath, ["worktree", "list"]).replaceAll("\\", "/");
        assert.equal(listed.includes(dest.replaceAll("\\", "/")), true);
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("addNoCheckout does not write worktree files", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-wt-nc-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        await invokePalSlot("worktree.addNoCheckout", { repositoryPath, dest, target: "HEAD" });
        assert.equal(existsSync(join(dest, "worktree-golden.txt")), false);
        assert.equal(existsSync(join(dest, ".git")), true);
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("move then removeForce updates and deletes the linked worktree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-wt-mv-"));
      const moved = `${dest}-moved`;
      rmSync(dest, { recursive: true, force: true });
      try {
        await invokePalSlot("worktree.addDetach", { repositoryPath, dest, target: "HEAD" });
        await invokePalSlot("worktree.move", { repositoryPath, path: dest, dest: moved });
        assert.equal(existsSync(join(moved, "worktree-golden.txt")), true);
        await invokePalSlot("worktree.removeForce", { repositoryPath, dest: moved });
        assert.equal(existsSync(moved), false);
      } finally {
        rmSync(dest, { recursive: true, force: true });
        rmSync(moved, { recursive: true, force: true });
      }
    });
  });

  it("prune drops admin for a deleted worktree directory", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-wt-prune-"));
      rmSync(dest, { recursive: true, force: true });
      await invokePalSlot("worktree.addDetach", { repositoryPath, dest, target: "HEAD" });
      rmSync(dest, { recursive: true, force: true });
      assert.equal(await invokePalSlot("worktree.prune", { repositoryPath }), "");
      const listed = git(repositoryPath, ["worktree", "list"]);
      assert.equal(listed.includes("grits-wt-prune-"), false);
    });
  });

  it("sparseCheckoutSet keeps cone paths and root files", async () => {
    await withOracleRepo(async (repositoryPath) => {
      mkdirSync(join(repositoryPath, "keep"), { recursive: true });
      mkdirSync(join(repositoryPath, "drop"), { recursive: true });
      writeFileSync(join(repositoryPath, "keep", "in.txt"), "in\n", "utf8");
      writeFileSync(join(repositoryPath, "drop", "out.txt"), "out\n", "utf8");
      gitId(repositoryPath, ["add", "."]);
      gitId(repositoryPath, ["commit", "-m", "sparse-paths"]);
      await invokePalSlot("worktree.sparseCheckoutInitCone", { repositoryPath });
      await invokePalSlot("worktree.sparseCheckoutSet", {
        repositoryPath,
        paths: ["keep"],
      });
      assert.equal(existsSync(join(repositoryPath, "worktree-golden.txt")), true);
      assert.equal(existsSync(join(repositoryPath, "keep", "in.txt")), true);
      assert.equal(existsSync(join(repositoryPath, "drop", "out.txt")), false);
    });
  });
});
