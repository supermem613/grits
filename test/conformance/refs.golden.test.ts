import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_REF_SLOTS = [
  "refs.updateRefCas",
  "refs.fastForwardCheckout",
  "refs.updateRef",
  "refs.updateRefNoDeref",
  "refs.remoteBranchesContaining",
  "refs.deleteRef",
  "refs.tagDelete",
  "refs.tagCreate",
  "refs.tagAnnotated",
  "refs.tagList",
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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-refs-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "ref-golden.txt"), "golden-ref\n", "utf8");
      gitId(repositoryPath, ["add", "ref-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-ref"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("refs family goldens", () => {
  for (const slotId of NYI_REF_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
        assert.match(headId, /^[0-9a-f]{40}$/);
        assert.equal(await invokePalSlot(slotId, { repositoryPath }), headId);
      });
    });
  }
});
