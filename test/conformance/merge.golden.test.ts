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

  it("rebaseAbort without state is INVALID_CONFIG, not NYI", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await assert.rejects(
        () => invokePalSlot("merge.rebaseAbort", { repositoryPath }),
        (error: Error & { code?: string }) =>
          error.code === "INVALID_CONFIG" && error.message.includes("No rebase in progress"),
      );
    });
  });

  it("rebaseOnto replays a linear first-parent commit", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      const main = gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      gitId(repositoryPath, ["update-ref", "HEAD", firstId]);
      gitId(repositoryPath, ["checkout", "-B", "topic"]);
      writeFileSync(join(repositoryPath, "topic.txt"), "topic\n", "utf8");
      gitId(repositoryPath, ["add", "topic.txt"]);
      gitId(repositoryPath, ["commit", "-m", "topic"]);
      const topicTip = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      gitId(repositoryPath, ["update-ref", `refs/heads/${main}`, secondId]);
      assert.equal(
        await invokePalSlot("merge.rebaseOnto", {
          repositoryPath,
          target: secondId,
          otherRev: firstId,
          name: "topic",
        }),
        "",
      );
      const rebased = gitId(repositoryPath, ["rev-parse", "refs/heads/topic"]);
      assert.notEqual(rebased, topicTip);
      assert.equal(gitId(repositoryPath, ["rev-parse", `${rebased}^`]), secondId);
      assert.equal(gitId(repositoryPath, ["cat-file", "-p", `${rebased}:topic.txt`]), "topic");
      assert.equal(gitId(repositoryPath, ["cat-file", "-p", `${rebased}:merge-golden.txt`]), "second");
    });
  });

  it("rebaseOnto conflicts then abort restores ORIG_HEAD", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      const main = gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      gitId(repositoryPath, ["update-ref", "HEAD", firstId]);
      gitId(repositoryPath, ["checkout", "-B", "topic"]);
      writeFileSync(join(repositoryPath, "merge-golden.txt"), "topic-change\n", "utf8");
      gitId(repositoryPath, ["add", "merge-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "topic-conflict"]);
      const orig = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      gitId(repositoryPath, ["update-ref", `refs/heads/${main}`, secondId]);
      await assert.rejects(
        () =>
          invokePalSlot("merge.rebaseOnto", {
            repositoryPath,
            target: secondId,
            otherRev: firstId,
            name: "topic",
          }),
        (error: Error & { code?: string }) =>
          error.code === "INVALID_CONFIG" && error.message.startsWith("rebase conflict:"),
      );
      assert.equal(await invokePalSlot("merge.rebaseAbort", { repositoryPath }), "");
      assert.equal(gitId(repositoryPath, ["rev-parse", "HEAD"]), orig);
    });
  });
});
