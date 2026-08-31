import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_SYSTEM_SLOTS = [
  "system.selfUpdate",
  "system.selfBuild",
  "system.launchBrowserWindow",
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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-system-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "system-golden.txt"), "golden-system\n", "utf8");
      gitId(repositoryPath, ["add", "system-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-system"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("system family goldens", () => {
  for (const slotId of NYI_SYSTEM_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const version = gitId(repositoryPath, ["--version"]);
        assert.match(version, /^git version /);
        const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
        assert.match(headId, /^[0-9a-f]{40}$/);
        assert.equal(await invokePalSlot(slotId), headId);
      });
    });
  }
});
