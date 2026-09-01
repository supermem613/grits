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
  it("tagList matches git tag and is not HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      gitId(repositoryPath, ["tag", "v1"]);
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      const listed = await invokePalSlot("refs.tagList", { repositoryPath });
      assert.equal(listed, git(repositoryPath, ["tag"]));
      assert.notEqual(listed.trim(), headId);
      assert.match(listed, /^v1$/m);
    });
  });

  it("tagCreate writes a lightweight tag at HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(await invokePalSlot("refs.tagCreate", { repositoryPath, name: "v2" }), "");
      assert.equal(gitId(repositoryPath, ["rev-parse", "refs/tags/v2"]), headId);
    });
  });

  it("tagDelete removes the tag", async () => {
    await withOracleRepo(async (repositoryPath) => {
      gitId(repositoryPath, ["tag", "gone"]);
      assert.equal(await invokePalSlot("refs.tagDelete", { repositoryPath, name: "gone" }), "");
      assert.equal(git(repositoryPath, ["tag"]), "");
    });
  });

  it("tagAnnotated writes a tag object, not a lightweight tag", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("refs.tagAnnotated", {
          repositoryPath,
          name: "v3",
          message: "annotated",
        }),
        "",
      );
      const tagId = gitId(repositoryPath, ["rev-parse", "refs/tags/v3"]);
      assert.notEqual(tagId, headId);
      assert.equal(gitId(repositoryPath, ["cat-file", "-t", tagId]), "tag");
    });
  });

  it("updateRef moves a branch to a new commit", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "ref-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "ref-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const second = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      const first = gitId(repositoryPath, ["rev-parse", "HEAD^"]);
      gitId(repositoryPath, ["update-ref", "refs/heads/topic", first]);
      assert.equal(
        await invokePalSlot("refs.updateRef", {
          repositoryPath,
          ref: "refs/heads/topic",
          newId: second,
        }),
        "",
      );
      assert.equal(gitId(repositoryPath, ["rev-parse", "refs/heads/topic"]), second);
    });
  });

  it("updateRefNoDeref detaches HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("refs.updateRefNoDeref", {
          repositoryPath,
          ref: "HEAD",
          newId: headId,
        }),
        "",
      );
      assert.equal(gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
    });
  });

  it("deleteRef removes refs/heads/topic", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      gitId(repositoryPath, ["update-ref", "refs/heads/topic", headId]);
      assert.equal(
        await invokePalSlot("refs.deleteRef", { repositoryPath, ref: "refs/heads/topic" }),
        "",
      );
      let missing = "";
      try {
        missing = gitId(repositoryPath, ["rev-parse", "--verify", "refs/heads/topic"]);
      } catch {
        missing = "gone";
      }
      assert.equal(missing, "gone");
    });
  });

  it("updateRefCas rejects a stale oldId", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      await assert.rejects(
        () =>
          invokePalSlot("refs.updateRefCas", {
            repositoryPath,
            ref: "HEAD",
            oldId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            newId: headId,
          }),
        /CAS failed/,
      );
    });
  });

  it("remoteBranchesContaining lists remotes that contain HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      gitId(repositoryPath, ["update-ref", "refs/remotes/origin/main", headId]);
      const listed = await invokePalSlot("refs.remoteBranchesContaining", {
        repositoryPath,
        rev: headId,
      });
      assert.match(listed, /origin\/main/);
      assert.notEqual(listed.trim(), headId);
    });
  });

  it("fastForwardCheckout advances HEAD to a descendant", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const first = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(repositoryPath, "ref-golden.txt"), "second\n", "utf8");
      gitId(repositoryPath, ["add", "ref-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "second"]);
      const second = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      gitId(repositoryPath, ["update-ref", "HEAD", first]);
      assert.equal(
        await invokePalSlot("refs.fastForwardCheckout", { repositoryPath, target: second }),
        "",
      );
      assert.equal(gitId(repositoryPath, ["rev-parse", "HEAD"]), second);
    });
  });
});

