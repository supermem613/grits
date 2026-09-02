import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { headTreeId } from "../../src/internal/git-object.js";
import { originUrl } from "../../src/internal/git-config.js";
import { worktreeListPorcelain } from "../../src/internal/worktree-list.js";
import { firstParentId } from "../../src/internal/git-object.js";
import { nameStatusHeadParent } from "../../src/internal/name-status.js";
import { blamePorcelain } from "../../src/internal/blame-porcelain.js";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  });
}

function gitId(repositoryPath: string, args: readonly string[]): string {
  return git(repositoryPath, args).trim();
}

function withRepo(
  prefix: string,
  setup: (repositoryPath: string) => void,
  run: (repositoryPath: string) => Promise<void>,
): Promise<void> {
  const repositoryPath = mkdtempSync(join(tmpdir(), prefix));
  return Promise.resolve()
    .then(async () => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      setup(repositoryPath);
      await run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("native oracles", () => {
  it("headTreeId matches git write-tree after a clean commit", async () => {
    await withRepo(
      "grits-head-tree-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "index-golden.txt"), "golden-index\n", "utf8");
        gitId(repositoryPath, ["add", "index-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "golden-index"]);
      },
      async (repositoryPath) => {
        assert.equal(await headTreeId(repositoryPath), gitId(repositoryPath, ["write-tree"]));
      },
    );
  });

  it("firstParentId matches git merge-base of HEAD^ and HEAD", async () => {
    await withRepo(
      "grits-merge-base-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "merge-golden.txt"), "first\n", "utf8");
        gitId(repositoryPath, ["add", "merge-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "first"]);
        writeFileSync(join(repositoryPath, "merge-golden.txt"), "second\n", "utf8");
        gitId(repositoryPath, ["add", "merge-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "second"]);
      },
      async (repositoryPath) => {
        const firstId = gitId(repositoryPath, ["rev-parse", "HEAD^"]);
        const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
        assert.equal(
          await firstParentId(repositoryPath),
          gitId(repositoryPath, ["merge-base", firstId, secondId]),
        );
      },
    );
  });

  it("originUrl matches git remote get-url origin", async () => {
    await withRepo(
      "grits-origin-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "remote-golden.txt"), "golden-remote\n", "utf8");
        gitId(repositoryPath, ["add", "remote-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "golden-remote"]);
        gitId(repositoryPath, ["remote", "add", "origin", "https://example.test/grits.git"]);
      },
      async (repositoryPath) => {
        assert.equal(
          await originUrl(repositoryPath),
          gitId(repositoryPath, ["remote", "get-url", "origin"]),
        );
      },
    );
  });

  it("worktreeListPorcelain matches git worktree list --porcelain", async () => {
    await withRepo(
      "grits-worktree-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "worktree-golden.txt"), "golden-worktree\n", "utf8");
        gitId(repositoryPath, ["add", "worktree-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "golden-worktree"]);
      },
      async (repositoryPath) => {
        assert.equal(
          await worktreeListPorcelain(repositoryPath),
          git(repositoryPath, ["worktree", "list", "--porcelain"]),
        );
      },
    );
  });

  it("worktreeListPorcelain matches git through a linked path", async () => {
    await withRepo(
      "grits-worktree-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "worktree-golden.txt"), "golden-worktree\n", "utf8");
        gitId(repositoryPath, ["add", "worktree-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "golden-worktree"]);
      },
      async (repositoryPath) => {
        const linkParent = mkdtempSync(join(tmpdir(), "grits-worktree-link-"));
        const link = join(linkParent, "repo");
        try {
          symlinkSync(repositoryPath, link, process.platform === "win32" ? "junction" : "dir");
          assert.equal(
            await worktreeListPorcelain(link),
            git(repositoryPath, ["worktree", "list", "--porcelain"]),
          );
        } finally {
          rmSync(linkParent, { recursive: true, force: true });
        }
      },
    );
  });

  it("nameStatusHeadParent matches git diff --name-status HEAD^ HEAD", async () => {
    await withRepo(
      "grits-name-status-",
      (repositoryPath) => {
        gitId(repositoryPath, ["config", "core.autocrlf", "false"]);
        writeFileSync(join(repositoryPath, "diff-golden.txt"), "first\n", "utf8");
        gitId(repositoryPath, ["add", "diff-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "first"]);
        writeFileSync(join(repositoryPath, "diff-golden.txt"), "second\n", "utf8");
        gitId(repositoryPath, ["add", "diff-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "second"]);
      },
      async (repositoryPath) => {
        assert.equal(
          await nameStatusHeadParent(repositoryPath),
          git(repositoryPath, ["diff", "--name-status", "HEAD^", "HEAD"]),
        );
      },
    );
  });

  it("blamePorcelain matches git blame --porcelain for the committed file", async () => {
    await withRepo(
      "grits-blame-",
      (repositoryPath) => {
        writeFileSync(join(repositoryPath, "blame-golden.txt"), "golden-blame\n", "utf8");
        gitId(repositoryPath, ["add", "blame-golden.txt"]);
        gitId(repositoryPath, ["commit", "-m", "golden-blame"]);
      },
      async (repositoryPath) => {
        assert.equal(
          await blamePorcelain(repositoryPath),
          git(repositoryPath, ["blame", "--porcelain", "blame-golden.txt"]),
        );
      },
    );
  });
});
