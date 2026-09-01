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

  it("nameStatusZBetween matches git diff --name-status -z", async () => {
    await withOracleRepo(async (repositoryPath, firstId, secondId) => {
      assert.equal(
        await invokePalSlot("diff.nameStatusZBetween", {
          repositoryPath,
          rev: firstId,
          otherRev: secondId,
        }),
        git(repositoryPath, ["diff", "--name-status", "-z", firstId, secondId]),
      );
    });
  });

  it("nameStatusZ matches HEAD^ HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("diff.nameStatusZ", { repositoryPath }),
        git(repositoryPath, ["diff", "--name-status", "-z", "HEAD^", "HEAD"]),
      );
    });
  });

  it("unmergedNames is empty without conflicts", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(await invokePalSlot("diff.unmergedNames", { repositoryPath }), "");
    });
  });

  it("unmergedNames lists unique unmerged paths", async () => {
    await withOracleRepo(async (repositoryPath, firstId, _secondId) => {
      const baseBlob = gitId(repositoryPath, ["rev-parse", `${firstId}:diff-golden.txt`]);
      const oursBlob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "ours\n");
      const theirsBlob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "theirs\n");
      git(repositoryPath, ["update-index", "--index-info"], `100644 ${baseBlob} 1\tdiff-golden.txt\n100644 ${oursBlob} 2\tdiff-golden.txt\n100644 ${theirsBlob} 3\tdiff-golden.txt\n`);
      assert.equal(
        await invokePalSlot("diff.unmergedNames", { repositoryPath }),
        git(repositoryPath, ["diff", "--name-only", "--diff-filter=U"]),
      );
    });
  });

  it("noIndex matches git unified diff", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "left.txt"), "left\n", "utf8");
      writeFileSync(join(repositoryPath, "right.txt"), "right\n", "utf8");
      const actual = await invokePalSlot("diff.noIndex", {
        repositoryPath,
        path: "left.txt",
        dest: "right.txt",
      });
      let expected = "";
      try {
        expected = git(repositoryPath, ["-c", "core.abbrev=7", "diff", "--no-index", "--no-color", "left.txt", "right.txt"]);
      } catch (error) {
        expected = (error as { stdout?: string }).stdout ?? "";
      }
      assert.equal(actual, expected);
    });
  });

  it("configShowOrigin reports the local config file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const shown = await invokePalSlot("diff.configShowOrigin", {
        repositoryPath,
        path: "user.email",
      });
      assert.match(shown, /file:/);
      assert.match(shown, /grits@example\.test/);
    });
  });

  it("cachedQuiet is empty when the index matches HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(await invokePalSlot("diff.cachedQuiet", { repositoryPath }), "");
    });
  });
});
