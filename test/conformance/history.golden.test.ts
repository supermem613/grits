import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits } from "../../src/index.js";
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

function gitIsAncestor(
  repositoryPath: string,
  ancestorId: string,
  descendantId: string,
): boolean {
  const result = spawnSync("git", ["merge-base", "--is-ancestor", ancestorId, descendantId], {
    cwd: repositoryPath,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return true;
  }
  if (result.status === 1) {
    return false;
  }
  throw new Error(result.stderr || "git merge-base --is-ancestor failed");
}

function withOracleRepo<T>(
  run: (repositoryPath: string, firstId: string, secondId: string) => T | Promise<T>,
): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-history-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "history-golden.txt"), "first\n", "utf8");
      gitId(repositoryPath, ["add", "history-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "first"]);
      const firstId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "history-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "history-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const secondId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      return run(repositoryPath, firstId, secondId);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("history family goldens", () => {
  it("revParse matches git rev-parse HEAD", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      assert.equal(
        await invokePalSlot("history.revParse", { repositoryPath, rev: "HEAD" }),
        secondId,
      );
    });
  });

  it("revListCount matches git rev-list --count HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("history.revListCount", { repositoryPath, rev: "HEAD" }),
        gitId(repositoryPath, ["rev-list", "--count", "HEAD"]),
      );
    });
  });

  it("firstCommit is the root, not HEAD", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      assert.equal(
        await invokePalSlot("history.firstCommit", { repositoryPath, rev: "HEAD" }),
        firstId,
      );
      assert.notEqual(firstId, secondId);
    });
  });

  it("lookupBlobAt matches git rev-parse HEAD:path", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      const blob = await invokePalSlot("history.lookupBlobAt", {
        repositoryPath,
        rev: "HEAD",
        path: "history-golden.txt",
      });
      assert.equal(blob, gitId(repositoryPath, ["rev-parse", "HEAD:history-golden.txt"]));
      assert.notEqual(blob, secondId);
    });
  });

  it("mergeBase matches git merge-base", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      assert.equal(
        await invokePalSlot("history.mergeBase", {
          repositoryPath,
          rev: firstId,
          otherRev: secondId,
        }),
        gitId(repositoryPath, ["merge-base", firstId, secondId]),
      );
    });
  });

  it("splitPathRev splits path@rev", async () => {
    await withOracleRepo(async () => {
      assert.equal(
        await invokePalSlot("history.splitPathRev", { stdin: "history-golden.txt@HEAD" }),
        "history-golden.txt\tHEAD",
      );
    });
  });

  it("objectSizes returns the commit payload size", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      const size = await invokePalSlot("history.objectSizes", { repositoryPath, rev: secondId });
      assert.match(size, /^\d+$/);
      assert.notEqual(size, secondId);
    });
  });

  it("countCommits matches rev-list --count", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("history.countCommits", { repositoryPath, rev: "HEAD" }),
        gitId(repositoryPath, ["rev-list", "--count", "HEAD"]),
      );
    });
  });

  it("resolveCommit matches rev-parse HEAD", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      assert.equal(
        await invokePalSlot("history.resolveCommit", { repositoryPath, rev: "HEAD" }),
        secondId,
      );
    });
  });

  it("lookupBlobsAtBatch matches lookupBlobAt", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const one = await invokePalSlot("history.lookupBlobAt", {
        repositoryPath,
        rev: "HEAD",
        path: "history-golden.txt",
      });
      const batch = await invokePalSlot("history.lookupBlobsAtBatch", {
        repositoryPath,
        rev: "HEAD",
        path: "history-golden.txt",
      });
      assert.equal(batch, one);
    });
  });

  it("revListObjects includes the HEAD commit id", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      const listed = await invokePalSlot("history.revListObjects", {
        repositoryPath,
        rev: "HEAD",
      });
      assert.match(listed, new RegExp(`^${secondId}`, "m"));
    });
  });


  it("spawns git then matches history.isAncestor for history.isAncestor", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      const oracleTrue = gitIsAncestor(repositoryPath, firstId, secondId);
      const oracleFalse = gitIsAncestor(repositoryPath, secondId, firstId);
      const grits = createGrits({
        repository: { kind: "filesystem", path: repositoryPath },
      });
      assert.equal(await grits.history.isAncestor(firstId, secondId), oracleTrue);
      assert.equal(await grits.history.isAncestor(secondId, firstId), oracleFalse);
      assert.equal(oracleTrue, true);
      assert.equal(oracleFalse, false);
    });
  });

  it("spawns git then matches refs.resolve for history.resolveRev", async () => {
    await withOracleRepo(async (repositoryPath, _firstId, secondId) => {
      const oracleId = gitId(repositoryPath, [
        "rev-parse",
        "--verify",
        "--end-of-options",
        "HEAD",
      ]);
      assert.equal(oracleId, secondId);
      const grits = createGrits({
        repository: { kind: "filesystem", path: repositoryPath },
      });
      const resolved = await grits.refs.resolve("HEAD");
      assert.equal(resolved?.name, "HEAD");
      assert.equal(resolved?.objectId, oracleId);
    });
  });
});
