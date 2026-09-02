import { execFileSync } from "node:child_process";
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { git as gritsGit } from "../../src/index.js";
import { matchesGritsError } from "../helpers/grits-error.js";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

describe("git read commands", () => {
  it("reads seeded memory blobs and refs", async () => {
    const blob = {
      kind: "blob" as const,
      id: "blob-id",
      bytes: [65, 66, 67],
    };
    const ref = { name: "HEAD", objectId: "commit-id" };
    const repository = {
      kind: "memory" as const,
      seed: {
        objects: [blob],
        refs: [ref],
      },
    };

    assert.equal(await gritsGit.catBlob({ repository, rev: "blob-id" }), "ABC");
    assert.equal(await gritsGit.resolveRev({ repository, ref: "HEAD" }), "commit-id");
    await assert.rejects(
      gritsGit.catBlob({ repository, rev: "missing-object" }),
      (error: Error) => matchesGritsError(error, "NOT_FOUND", "objects.read"),
    );
    assert.equal(await gritsGit.resolveRev({ repository, ref: "missing-ref" }), "");
  });

  it("reads filesystem blob and HEAD", async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "grits-read-slice-"));
    try {
      git(repositoryPath, ["init"]);
      git(repositoryPath, ["config", "user.email", "grits@example.test"]);
      git(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "file.txt"), "hello\n");
      git(repositoryPath, ["add", "file.txt"]);
      git(repositoryPath, ["commit", "-m", "initial commit"]);

      const headId = git(repositoryPath, ["rev-parse", "HEAD"]);
      const blobId = git(repositoryPath, ["rev-parse", "HEAD:file.txt"]);
      assert.equal(
        await gritsGit.catBlob({ repositoryPath, rev: blobId }),
        "hello\n",
      );
      assert.equal(await gritsGit.resolveRev({ repositoryPath, ref: "HEAD" }), headId);
      await assert.rejects(
        gritsGit.catBlob({
          repositoryPath,
          rev: "0000000000000000000000000000000000000000",
        }),
        (error: Error) => matchesGritsError(error, "NOT_FOUND", "objects.read"),
      );
      assert.equal(
        await gritsGit.resolveRev({ repositoryPath, ref: "refs/does-not-exist" }),
        "",
      );

      git(repositoryPath, ["repack", "-ad"]);
      git(repositoryPath, ["prune-packed"]);
      assert.equal(
        await gritsGit.catBlob({ repositoryPath, rev: blobId }),
        "hello\n",
      );
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });
});
