import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { writePackIndex } from "../../src/internal/pack-read.js";
import { writePack } from "../../src/internal/pack-write.js";

const BLOB_TEXT = "packed-hello\n";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pack-write-"));
  git(repositoryPath, ["init"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

describe("pack v2 writer", () => {
  it("lets objects.read return a packed blob after writing an undeltified pack from a git commit", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);

      await withRepo(async (destPath) => {
        const destPackDir = join(destPath, ".git", "objects", "pack");
        mkdirSync(destPackDir, { recursive: true });
        const packPath = join(destPackDir, "pack-from-write.pack");
        await writePack(sourcePath, [commitId], packPath);
        await writePackIndex(packPath);
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: destPath, rev: blobId }),
          BLOB_TEXT,
        );
      });
    });
  });
});
