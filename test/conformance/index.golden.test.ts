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
  it("writeTree matches git write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("index.writeTree", { repositoryPath }),
        gitId(repositoryPath, ["write-tree"]),
      );
    });
  });

  it("statusPorcelain is empty on a clean tree and is not the tree id", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
      assert.notEqual(status.trim(), treeId);
    });
  });

  it("statusPorcelain reports an untracked file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "untracked.txt"), "new\n", "utf8");
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.match(status, /\?\? untracked\.txt/);
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
    });
  });

  it("statusPorcelain reports a worktree modification", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.match(status, /index-golden\.txt/);
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
    });
  });

  it("updateIndexForceRemove drops the path from the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await invokePalSlot("index.updateIndexForceRemove", {
        repositoryPath,
        path: "index-golden.txt",
      });
      const names = git(repositoryPath, ["ls-files"]);
      assert.equal(names.includes("index-golden.txt"), false);
    });
  });

  it("statusFull uses NUL porcelain and is not write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusFull", { repositoryPath });
      assert.equal(status, git(repositoryPath, ["status", "--porcelain=v1", "-z"]));
      assert.notEqual(status.replaceAll("\0", "").trim(), treeId);
    });
  });

  it("statusFullScoped limits status to one path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      writeFileSync(join(repositoryPath, "other.txt"), "other\n", "utf8");
      gitId(repositoryPath, ["add", "other.txt"]);
      writeFileSync(join(repositoryPath, "other.txt"), "dirty-other\n", "utf8");
      const status = await invokePalSlot("index.statusFullScoped", {
        repositoryPath,
        path: "index-golden.txt",
      });
      assert.match(status, /index-golden\.txt/);
      assert.equal(status.includes("other.txt"), false);
    });
  });

  it("stagedNames lists cached path names", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "staged\n", "utf8");
      gitId(repositoryPath, ["add", "index-golden.txt"]);
      assert.equal(
        await invokePalSlot("index.stagedNames", { repositoryPath }),
        git(repositoryPath, ["diff", "--cached", "--name-only", "-z", "--no-renames"]),
      );
    });
  });

  it("updateIndexInfo inserts a blob into the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "info\n");
      await invokePalSlot("index.updateIndexInfo", {
        repositoryPath,
        stdin: `100644 ${blob}\tinfo.txt\n`,
      });
      assert.match(git(repositoryPath, ["ls-files"]), /info\.txt/);
    });
  });

  it("updateIndexCacheinfo inserts a blob by oid and path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "cacheinfo\n");
      await invokePalSlot("index.updateIndexCacheinfo", {
        repositoryPath,
        path: "cacheinfo.txt",
        newId: blob,
      });
      assert.match(git(repositoryPath, ["ls-files"]), /cacheinfo\.txt/);
    });
  });

  it("statusBranch includes branch headers and is not write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusBranch", { repositoryPath });
      const branch = gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.match(status, new RegExp(`# branch\\.head ${branch}`));
      assert.match(status, new RegExp(`# branch\\.oid ${headId}`));
      assert.notEqual(branch, headId);
      assert.notEqual(status.replaceAll("\0", "").trim(), treeId);
    });
  });

  it("updateIndexForceRemovePathspec drops the path from the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await invokePalSlot("index.updateIndexForceRemovePathspec", {
        repositoryPath,
        path: "index-golden.txt",
      });
      assert.equal(git(repositoryPath, ["ls-files"]).includes("index-golden.txt"), false);
    });
  });

  it("readTree resets the index to HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
      assert.equal(
        await invokePalSlot("index.readTree", { repositoryPath, rev: "HEAD" }),
        treeId,
      );
    });
  });
});
