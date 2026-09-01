import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const ORIGIN_URL = "https://example.test/grits.git";

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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-remote-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "remote-golden.txt"), "golden-remote\n", "utf8");
      gitId(repositoryPath, ["add", "remote-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-remote"]);
      gitId(repositoryPath, ["remote", "add", "origin", ORIGIN_URL]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("remote family goldens", () => {
  it("originUrl matches git remote get-url origin", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("remote.originUrl", { repositoryPath }),
        gitId(repositoryPath, ["remote", "get-url", "origin"]),
      );
    });
  });

  for (const slotId of ["remote.fetchUpstream", "remote.pushFf", "remote.pushForceWithLease"] as const) {
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
