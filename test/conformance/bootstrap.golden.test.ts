import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-bootstrap-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "bootstrap-golden.txt"), "golden-bootstrap\n", "utf8");
      gitId(repositoryPath, ["add", "bootstrap-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-bootstrap"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("bootstrap family goldens", () => {
  it("init writes a git directory", async () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), "grits-bootstrap-init-"));
    try {
      assert.equal(await invokePalSlot("bootstrap.init", { repositoryPath }), "");
      assert.equal(gitId(repositoryPath, ["rev-parse", "--is-inside-work-tree"]), "true");
    } finally {
      rmSync(repositoryPath, { recursive: true, force: true });
    }
  });

  it("connect resolves HEAD of an existing repo", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.equal(await invokePalSlot("bootstrap.connect", { repositoryPath }), headId);
    });
  });

  it("clone copies a local repository", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-bootstrap-clone-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        assert.equal(
          await invokePalSlot("bootstrap.clone", {
            repositoryPath,
            path: repositoryPath,
            dest,
          }),
          "",
        );
        assert.equal(
          gitId(dest, ["rev-parse", "HEAD"]),
          gitId(repositoryPath, ["rev-parse", "HEAD"]),
        );
        assert.equal(
          gitId(dest, ["cat-file", "-p", "HEAD:bootstrap-golden.txt"]),
          "golden-bootstrap",
        );
        assert.equal(
          gitId(dest, ["remote", "get-url", "origin"]).replaceAll("\\", "/"),
          repositoryPath.replaceAll("\\", "/"),
        );
        const branch = gitId(dest, ["rev-parse", "--abbrev-ref", "HEAD"]);
        assert.equal(
          gitId(dest, ["rev-parse", `refs/remotes/origin/${branch}`]),
          gitId(dest, ["rev-parse", "HEAD"]),
        );
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("clone copies a local bare repository", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const bare = mkdtempSync(join(tmpdir(), "grits-bootstrap-bare-"));
      const dest = mkdtempSync(join(tmpdir(), "grits-bootstrap-from-bare-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        cpSync(join(repositoryPath, ".git", "objects"), join(bare, "objects"), { recursive: true });
        cpSync(join(repositoryPath, ".git", "refs"), join(bare, "refs"), { recursive: true });
        cpSync(join(repositoryPath, ".git", "HEAD"), join(bare, "HEAD"));
        assert.equal(
          await invokePalSlot("bootstrap.clone", {
            repositoryPath,
            path: bare,
            dest,
          }),
          "",
        );
        assert.equal(
          gitId(dest, ["rev-parse", "HEAD"]),
          gitId(repositoryPath, ["rev-parse", "HEAD"]),
        );
        assert.equal(
          gitId(dest, ["cat-file", "-p", "HEAD:bootstrap-golden.txt"]),
          "golden-bootstrap",
        );
      } finally {
        rmSync(bare, { recursive: true, force: true });
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("clone of a remote URL stays NYI", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await assert.rejects(
        () =>
          invokePalSlot("bootstrap.clone", {
            repositoryPath,
            path: "https://example.test/grits.git",
            dest: join(tmpdir(), "grits-bootstrap-remote-clone"),
          }),
        (error: Error & { code?: string }) =>
          error.code === "NYI" && error.message.includes("does not clone remote URLs"),
      );
    });
  });
});
