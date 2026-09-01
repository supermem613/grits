import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_DIFF_SLOTS = [
  "diff.nameStatusZ",
  "diff.nameStatusZBetween",
  "diff.noIndex",
  "diff.unmergedNames",
  "diff.cachedQuiet",
  "diff.configShowOrigin",
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

function withOracleRepo<T>(
  run: (repositoryPath: string, firstId: string, secondId: string) => T | Promise<T>,
): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-diff-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "core.autocrlf", "false"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "diff-golden.txt"), "first\n", "utf8");
      gitId(repositoryPath, ["add", "diff-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "first"]);
      const firstId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "diff-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "diff-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, firstId, secondId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("diff family goldens", () => {
  it("disables autocrlf in the oracle repo", async () => {
    await withOracleRepo((repositoryPath) => {
      let autocrlf = "";
      try {
        autocrlf = gitId(repositoryPath, ["config", "--local", "--get", "core.autocrlf"]);
      } catch {
        autocrlf = "";
      }
      assert.equal(autocrlf, "false");
    });
  });

  for (const slotId of NYI_DIFF_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath, firstId, secondId) => {
        const nameStatus = git(repositoryPath, ["diff", "--name-status", firstId, secondId]);
        assert.match(nameStatus, /^M\tdiff-golden\.txt/);
        assert.equal(await invokePalSlot(slotId, { repositoryPath }), nameStatus);
      });
    });
  }
});
