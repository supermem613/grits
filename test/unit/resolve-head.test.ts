import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHead } from "../../src/internal/resolve-head.js";

function gitId(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

describe("resolveHead", () => {
  it("matches git rev-parse HEAD after one commit", async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "grits-resolve-head-"));

    try {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "head.txt"), "head\n", "utf8");
      gitId(repositoryPath, ["add", "head.txt"]);
      gitId(repositoryPath, ["commit", "-m", "head"]);
      const oracleId = gitId(repositoryPath, ["rev-parse", "HEAD"]);

      assert.equal(await resolveHead(repositoryPath), oracleId);
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });
});
