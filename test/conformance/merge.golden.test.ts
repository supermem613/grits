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

function withOracleRepo<T>(
  run: (repositoryPath: string, firstId: string, secondId: string) => T | Promise<T>,
): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-merge-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "merge-golden.txt"), "first\n", "utf8");
      gitId(repositoryPath, ["add", "merge-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "first"]);
      const firstId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "merge-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "merge-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, firstId, secondId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("merge family goldens", () => {
  it("mergeFfOnly fast-forwards HEAD to the target", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      gitId(repositoryPath, ["update-ref", "HEAD", firstId]);
      assert.equal(
        await invokePalSlot("merge.mergeFfOnly", { repositoryPath, target: secondId }),
        "",
      );
      assert.equal(gitId(repositoryPath, ["rev-parse", "HEAD"]), secondId);
    });
  });

  it("rebaseOnto stays NYI", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await assert.rejects(
        () => invokePalSlot("merge.rebaseOnto", { repositoryPath, target: "HEAD" }),
        (error: Error & { code?: string }) => error.code === "NYI",
      );
    });
  });

  it("rebaseAbort stays NYI", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await assert.rejects(
        () => invokePalSlot("merge.rebaseAbort", { repositoryPath }),
        (error: Error & { code?: string }) => error.code === "NYI",
      );
    });
  });
});
