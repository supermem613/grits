import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { writePackIndex } from "../../src/internal/pack-read.js";
import { isRuntimeString } from "../../src/internal/runtime-type.js";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pack-index-"));
  git(repositoryPath, ["init"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

describe("pack index writer", () => {
  it("lets objects.read return packed blobs after writing idx v2 for an oracle pack", async () => {
    await withRepo(async (sourcePath) => {
      const base = `${"alpha\n".repeat(40)}base-tail\n`;
      writeFileSync(join(sourcePath, "delta.txt"), base, "utf8");
      git(sourcePath, ["add", "delta.txt"]);
      git(sourcePath, ["commit", "-m", "delta-base"]);
      const firstBlob = git(sourcePath, ["rev-parse", "HEAD:delta.txt"]);
      writeFileSync(join(sourcePath, "delta.txt"), `${"alpha\n".repeat(40)}changed-tail\n`, "utf8");
      git(sourcePath, ["add", "delta.txt"]);
      git(sourcePath, ["commit", "-m", "delta-changed"]);
      const secondBlob = git(sourcePath, ["rev-parse", "HEAD:delta.txt"]);
      git(sourcePath, ["repack", "-ad"]);
      git(sourcePath, ["prune-packed"]);
      const packDir = join(sourcePath, ".git", "objects", "pack");
      const packName = readdirSync(packDir).find((name) => name.endsWith(".pack"));
      if (!isRuntimeString(packName)) {
        throw new Error("repack did not write a pack file");
      }
      assert.equal(packName.endsWith(".pack"), true);

      await withRepo(async (destPath) => {
        const destPackDir = join(destPath, ".git", "objects", "pack");
        mkdirSync(destPackDir, { recursive: true });
        copyFileSync(join(packDir, packName), join(destPackDir, packName));
        await writePackIndex(join(destPackDir, packName));
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: destPath, rev: firstBlob }),
          base,
        );
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: destPath, rev: secondBlob }),
          `${"alpha\n".repeat(40)}changed-tail\n`,
        );
      });
    });
  });
});
