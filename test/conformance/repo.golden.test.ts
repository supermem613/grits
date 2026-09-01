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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-repo-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "repo-golden.txt"), "golden-repo\n", "utf8");
      gitId(repositoryPath, ["add", "repo-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-repo"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("repo family goldens", () => {
  it("init writes a git directory", async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "grits-repo-init-"));
    try {
      assert.equal(await invokePalSlot("repo.init", { repositoryPath }), "");
      assert.equal(gitId(repositoryPath, ["rev-parse", "--git-dir"]), ".git");
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });

  it("connect resolves HEAD of an existing repo", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(await invokePalSlot("repo.connect", { repositoryPath }), headId);
    });
  });

  it("clone stays NYI", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await assert.rejects(
        () => invokePalSlot("repo.clone", { repositoryPath }),
        (error: Error & { code?: string }) => error.code === "NYI",
      );
    });
  });
});
