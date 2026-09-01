import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readLooseObject } from "../../src/internal/git-object.js";
import { readPackedObject } from "../../src/internal/pack-read.js";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pack-"));
  git(repositoryPath, ["init"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

describe("pack v2 reader", () => {
  it("reads packed commit, tree, and blob bytes that match git cat-file", async () => {
    await withRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "file.txt"), "packed-hello\n", "utf8");
      git(repositoryPath, ["add", "file.txt"]);
      git(repositoryPath, ["commit", "-m", "packed-hello"]);
      const headId = git(repositoryPath, ["rev-parse", "HEAD"]);
      const treeId = git(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
      const blobId = git(repositoryPath, ["rev-parse", "HEAD:file.txt"]);
      git(repositoryPath, ["repack", "-ad"]);
      git(repositoryPath, ["prune-packed"]);

      const commit = await readLooseObject(repositoryPath, headId);
      const tree = await readLooseObject(repositoryPath, treeId);
      const blob = await readLooseObject(repositoryPath, blobId);
      assert.equal(commit.type, "commit");
      assert.equal(tree.type, "tree");
      assert.equal(blob.type, "blob");
      assert.equal(
        commit.payload.toString("utf8"),
        execFileSync("git", ["cat-file", "commit", headId], {
          cwd: repositoryPath,
          encoding: "utf8",
        }),
      );
      assert.deepEqual(blob.payload, Buffer.from("packed-hello\n"));
      assert.equal(await readPackedObject(repositoryPath, "0000000000000000000000000000000000000000"), null);
    });
  });

  it("resolves ofs-delta packed blobs after a similar second commit", async () => {
    await withRepo(async (repositoryPath) => {
      const base = `${"alpha\n".repeat(40)}base-tail\n`;
      writeFileSync(join(repositoryPath, "delta.txt"), base, "utf8");
      git(repositoryPath, ["add", "delta.txt"]);
      git(repositoryPath, ["commit", "-m", "delta-base"]);
      const firstBlob = git(repositoryPath, ["rev-parse", "HEAD:delta.txt"]);
      writeFileSync(join(repositoryPath, "delta.txt"), `${"alpha\n".repeat(40)}changed-tail\n`, "utf8");
      git(repositoryPath, ["add", "delta.txt"]);
      git(repositoryPath, ["commit", "-m", "delta-changed"]);
      const secondBlob = git(repositoryPath, ["rev-parse", "HEAD:delta.txt"]);
      git(repositoryPath, ["repack", "-ad"]);
      git(repositoryPath, ["prune-packed"]);

      const first = await readLooseObject(repositoryPath, firstBlob);
      const second = await readLooseObject(repositoryPath, secondBlob);
      assert.equal(first.type, "blob");
      assert.equal(second.type, "blob");
      assert.equal(first.payload.toString("utf8"), base);
      assert.equal(second.payload.toString("utf8"), `${"alpha\n".repeat(40)}changed-tail\n`);
    });
  });
});
