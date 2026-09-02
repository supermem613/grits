import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const BLOB_TEXT = "file-url-hello\n";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "safe.bareRepository=all", ...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pal-file-url-"));
  git(repositoryPath, ["init", "-b", "main"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

describe("PAL file URL remotes", () => {
  it("clone copies a local repository from a file URL", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "file-url-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const dest = mkdtempSync(join(tmpdir(), "grits-pal-file-url-clone-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        assert.equal(
          await invokePalSlot("bootstrap.clone", {
            repositoryPath: sourcePath,
            path: pathToFileURL(sourcePath).href,
            dest,
          }),
          "",
        );
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: dest, rev: blobId }),
          BLOB_TEXT,
        );
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("fetchUpstream copies objects from a file URL origin", async () => {
    await withRepo(async (originPath) => {
      writeFileSync(join(originPath, "file.txt"), BLOB_TEXT, "utf8");
      git(originPath, ["add", "file.txt"]);
      git(originPath, ["commit", "-m", "file-url-hello"]);
      const blobId = git(originPath, ["rev-parse", "HEAD:file.txt"]);
      const originTip = git(originPath, ["rev-parse", "HEAD"]);
      await withRepo(async (localPath) => {
        git(localPath, ["remote", "add", "origin", pathToFileURL(originPath).href]);
        assert.equal(
          await invokePalSlot("remote.fetchUpstream", {
            repositoryPath: localPath,
            name: "origin",
            rev: "main",
          }),
          originTip,
        );
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: localPath, rev: blobId }),
          BLOB_TEXT,
        );
      });
    });
  });

  it("pushFf fast-forwards a bare file URL origin", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "file-url-hello"]);
      const barePath = mkdtempSync(join(tmpdir(), "grits-pal-file-url-bare-"));
      rmSync(barePath, { recursive: true, force: true });
      git(sourcePath, ["clone", "--bare", sourcePath, barePath]);
      const localPath = mkdtempSync(join(tmpdir(), "grits-pal-file-url-push-"));
      rmSync(localPath, { recursive: true, force: true });
      git(sourcePath, ["clone", sourcePath, localPath]);
      git(localPath, ["config", "user.email", "grits@example.test"]);
      git(localPath, ["config", "user.name", "Grits Test"]);
      git(localPath, ["remote", "set-url", "origin", pathToFileURL(barePath).href]);
      try {
        writeFileSync(join(localPath, "file.txt"), "file-url-pushed\n", "utf8");
        git(localPath, ["add", "file.txt"]);
        git(localPath, ["commit", "-m", "file-url-pushed"]);
        const localTip = git(localPath, ["rev-parse", "HEAD"]);
        const blobId = git(localPath, ["rev-parse", "HEAD:file.txt"]);
        assert.equal(
          await invokePalSlot("remote.pushFf", {
            repositoryPath: localPath,
            name: "origin",
            rev: "main",
            newId: localTip,
          }),
          "",
        );
        assert.equal(git(barePath, ["rev-parse", "refs/heads/main"]), localTip);
        assert.equal(
          await gritsGit.catBlob({ repositoryPath: barePath, rev: blobId }),
          "file-url-pushed\n",
        );
      } finally {
        rmSync(barePath, { recursive: true, force: true });
        rmSync(localPath, { recursive: true, force: true });
      }
    });
  });
});
