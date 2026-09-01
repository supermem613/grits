import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  it("lsTreeNameOnly matches git ls-tree --name-only HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      const listed = await invokePalSlot("commit.lsTreeNameOnly", { repositoryPath, rev: "HEAD" });
      assert.equal(listed, git(repositoryPath, ["ls-tree", "--name-only", "HEAD"]));
      assert.notEqual(listed.trim(), headId);
    });
  });

  it("lsTreeNameOnlyZ uses NUL separators", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("commit.lsTreeNameOnlyZ", { repositoryPath, rev: "HEAD" }),
        git(repositoryPath, ["ls-tree", "--name-only", "-z", "HEAD"]),
      );
    });
  });

  it("lsTreeRecursiveZ matches git ls-tree -r -z HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("commit.lsTreeRecursiveZ", { repositoryPath, rev: "HEAD" }),
        git(repositoryPath, ["ls-tree", "-r", "-z", "HEAD"]),
      );
    });
  });

  it("lsTreePath matches git ls-tree HEAD -- path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("commit.lsTreePath", {
          repositoryPath,
          rev: "HEAD",
          path: "commit-golden.txt",
        }),
        git(repositoryPath, ["ls-tree", "HEAD", "--", "commit-golden.txt"]),
      );
    });
  });

  it("catFileType matches git cat-file -t HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("commit.catFileType", { repositoryPath, rev: headId }),
        git(repositoryPath, ["cat-file", "-t", headId]),
      );
    });
  });

  it("show returns the commit message, not the commit id", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      const shown = await invokePalSlot("commit.show", { repositoryPath, rev: "HEAD" });
      assert.match(shown, /golden-commit/);
      assert.notEqual(shown.trim(), headId);
    });
  });

  it("logFormat returns the subject", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        (await invokePalSlot("commit.logFormat", { repositoryPath, rev: "HEAD" })).trim(),
        gitId(repositoryPath, ["log", "-1", "--format=%s"]),
      );
    });
  });

  it("revListParents matches git rev-list --parents -n 1 HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("commit.revListParents", { repositoryPath, rev: "HEAD" }),
        git(repositoryPath, ["rev-list", "--parents", "-n", "1", "HEAD"]),
      );
    });
  });

  it("commitTree writes a commit object for the current tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const tree = gitId(repositoryPath, ["write-tree"]);
      const parent = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      const id = await invokePalSlot("commit.commitTree", {
        repositoryPath,
        tree,
        parents: [parent],
        message: "from-pal",
      });
      assert.match(id, /^[0-9a-f]{40}$/);
      assert.equal(gitId(repositoryPath, ["cat-file", "-t", id]), "commit");
      assert.equal(gitId(repositoryPath, ["rev-parse", `${id}^{tree}`]), tree);
    });
  });

  it("mktree matches git mktree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "tree-entry\n");
      const stdin = `100644 blob ${blob}\tmktree.txt\n`;
      const oracle = gitId(repositoryPath, ["mktree"], stdin);
      assert.equal(await invokePalSlot("commit.mktree", { repositoryPath, stdin }), oracle);
    });
  });

  it("lsTreeInfoZ matches git ls-tree -z HEAD -- path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("commit.lsTreeInfoZ", {
          repositoryPath,
          rev: "HEAD",
          path: "commit-golden.txt",
        }),
        git(repositoryPath, ["ls-tree", "-z", "HEAD", "--", "commit-golden.txt"]),
      );
    });
  });
});
