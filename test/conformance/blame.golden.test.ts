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
  it("porcelain matches git blame --porcelain", async () => {
    await withOracleRepo(async (repositoryPath, commitId) => {
      const porcelain = git(repositoryPath, ["blame", "--porcelain", "blame-golden.txt"]);
      assert.match(porcelain, new RegExp(`^${commitId} `));
      assert.equal(
        await invokePalSlot("blame.porcelain", { repositoryPath, path: "blame-golden.txt" }),
        porcelain,
      );
    });
  });

  it("porcelain matches git blame for a two-line file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "blame-golden.txt"), "line-one\nline-two\n", "utf8");
      gitId(repositoryPath, ["add", "blame-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "two-line-blame"]);
      const porcelain = git(repositoryPath, ["blame", "--porcelain", "blame-golden.txt"]);
      assert.match(porcelain, /line-one/);
      assert.match(porcelain, /line-two/);
      assert.equal(
        await invokePalSlot("blame.porcelain", { repositoryPath, path: "blame-golden.txt" }),
        porcelain,
      );
    });
  });

  it("revPath requires a path and matches git blame --porcelain -- path", async () => {
    await withOracleRepo(async (repositoryPath, commitId) => {
      const porcelain = git(repositoryPath, ["blame", "--porcelain", "HEAD", "--", "blame-golden.txt"]);
      assert.match(porcelain, new RegExp(`^${commitId} `));
      assert.equal(
        await invokePalSlot("blame.revPath", {
          repositoryPath,
          path: "blame-golden.txt",
          rev: "HEAD",
        }),
        porcelain,
      );
    });
  });
});
