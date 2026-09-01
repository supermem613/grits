import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createGrits } from "../../src/index.js";
import { matchesGritsError } from "../helpers/grits-error.js";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

describe("Grits read slice", () => {
  it("reads frozen seeded memory objects and refs without fallback", async () => {
    const blob = {
      kind: "blob" as const,
      id: "blob-id",
      bytes: [65, 66, 67],
    };
    const tree = {
      kind: "tree" as const,
      id: "tree-id",
      entries: [{ mode: "100644", name: "file.txt", objectId: blob.id }],
    };
    const commit = {
      kind: "commit" as const,
      id: "commit-id",
      tree: tree.id,
      parents: new Array<string>(),
      message: "memory commit",
    };
    const ref = { name: "HEAD", objectId: commit.id };
    const grits = createGrits({
      repository: {
        kind: "memory",
        seed: {
          objects: [blob, tree, commit],
          refs: [ref],
        },
      },
    });

    blob.bytes[0] = 90;
    tree.entries[0].name = "changed.txt";
    commit.parents.push("parent-id");
    ref.objectId = "changed-id";

    const actualBlob = await grits.objects.read("blob-id");
    const actualTree = await grits.objects.read("tree-id");
    const actualCommit = await grits.objects.read("commit-id");
    const actualRef = await grits.refs.resolve("HEAD");

    assert.deepEqual(actualBlob, {
      kind: "blob",
      id: "blob-id",
      bytes: [65, 66, 67],
    });
    assert.deepEqual(actualTree, {
      kind: "tree",
      id: "tree-id",
      entries: [{ mode: "100644", name: "file.txt", objectId: "blob-id" }],
    });
    assert.deepEqual(actualCommit, {
      kind: "commit",
      id: "commit-id",
      tree: "tree-id",
      parents: [],
      message: "memory commit",
    });
    assert.deepEqual(actualRef, { name: "HEAD", objectId: "commit-id" });
    assert.equal(Object.isFrozen(actualBlob), true);
    assert.equal(Object.isFrozen(actualBlob.bytes), true);
    assert.equal(Object.isFrozen(actualTree), true);
    assert.equal(Object.isFrozen(actualTree.entries), true);
    assert.equal(Object.isFrozen(actualTree.entries[0]), true);
    assert.equal(Object.isFrozen(actualCommit), true);
    assert.equal(Object.isFrozen(actualCommit.parents), true);
    assert.equal(Object.isFrozen(actualRef), true);

    await assert.rejects(grits.objects.read("missing-object"), (error: Error) =>
      matchesGritsError(error, "NOT_FOUND", "objects.read"),
    );
    assert.equal(await grits.refs.resolve("missing-ref"), null);
  });

  it("reads filesystem blob, tree, commit, and HEAD values", async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "grits-read-slice-"));
    try {
      git(repositoryPath, ["init"]);
      git(repositoryPath, ["config", "user.email", "grits@example.test"]);
      git(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "file.txt"), "hello\n");
      git(repositoryPath, ["add", "file.txt"]);
      git(repositoryPath, ["commit", "-m", "initial commit"]);

      const headId = git(repositoryPath, ["rev-parse", "HEAD"]);
      const treeId = git(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
      const blobId = git(repositoryPath, ["rev-parse", "HEAD:file.txt"]);
      const grits = createGrits({
        repository: { kind: "filesystem", path: repositoryPath },
      });

      const blob = await grits.objects.read(blobId);
      const tree = await grits.objects.read(treeId);
      const commit = await grits.objects.read(headId);
      const head = await grits.refs.resolve("HEAD");

      assert.deepEqual(blob, {
        kind: "blob",
        id: blobId,
        bytes: Array.from(Buffer.from("hello\n")),
      });
      assert.deepEqual(tree, {
        kind: "tree",
        id: treeId,
        entries: [{ mode: "100644", name: "file.txt", objectId: blobId }],
      });
      assert.deepEqual(commit, {
        kind: "commit",
        id: headId,
        tree: treeId,
        parents: [],
        message: "initial commit\n",
      });
      assert.deepEqual(head, { name: "HEAD", objectId: headId });
      assert.equal(Object.isFrozen(blob), true);
      assert.equal(Object.isFrozen(blob.bytes), true);
      assert.equal(Object.isFrozen(tree), true);
      assert.equal(Object.isFrozen(tree.entries), true);
      assert.equal(Object.isFrozen(commit), true);
      assert.equal(Object.isFrozen(commit.parents), true);
      assert.equal(Object.isFrozen(head), true);

      await assert.rejects(
        grits.objects.read("0000000000000000000000000000000000000000"),
        (error: Error) => matchesGritsError(error, "NOT_FOUND", "objects.read"),
      );
      assert.equal(await grits.refs.resolve("refs/does-not-exist"), null);

      git(repositoryPath, ["repack", "-ad"]);
      git(repositoryPath, ["prune-packed"]);
      const packedCommit = await grits.objects.read(headId);
      assert.equal(packedCommit.kind, "commit");
      assert.equal(packedCommit.id, headId);
      if (packedCommit.kind === "commit") {
        assert.equal(packedCommit.tree, treeId);
        assert.equal(packedCommit.message, "initial commit\n");
      }
      const packedBlob = await grits.objects.read(blobId);
      assert.deepEqual(packedBlob, {
        kind: "blob",
        id: blobId,
        bytes: Array.from(Buffer.from("hello\n")),
      });
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });

  it("does not access a filesystem repository during construction", () => {
    assert.doesNotThrow(() =>
      createGrits({
        repository: { kind: "filesystem", path: "path-that-does-not-exist" },
      }),
    );
  });
});
