import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const ORIGIN_URL = "https://example.test/grits.git";
const SSH_ORIGIN_URL = "ssh://example.test/grits.git";

const GIT_TEST_IDENTITY = {
  GIT_AUTHOR_NAME: "Grits Test",
  GIT_AUTHOR_EMAIL: "grits@example.test",
  GIT_COMMITTER_NAME: "Grits Test",
  GIT_COMMITTER_EMAIL: "grits@example.test",
} as const;

function git(repositoryPath: string, args: readonly string[], stdin?: string): string {
  return execFileSync("git", ["-c", "safe.bareRepository=all", ...args], {
    cwd: repositoryPath,
    encoding: "utf8",
    input: stdin,
    env: { ...process.env, ...GIT_TEST_IDENTITY },
  });
}

function gitId(repositoryPath: string, args: readonly string[], stdin?: string): string {
  return git(repositoryPath, args, stdin).trim();
}

function withOracleRepo<T>(run: (repositoryPath: string) => T | Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-remote-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "remote-golden.txt"), "golden-remote\n", "utf8");
      gitId(repositoryPath, ["add", "remote-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-remote"]);
      gitId(repositoryPath, ["remote", "add", "origin", ORIGIN_URL]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("remote family goldens", () => {
  it("originUrl matches git remote get-url origin", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("remote.originUrl", { repositoryPath }),
        gitId(repositoryPath, ["remote", "get-url", "origin"]),
      );
    });
  });

  for (const slotId of ["remote.fetchUpstream", "remote.pushFf", "remote.pushForceWithLease"] as const) {
    it(`${slotId} stays NYI for an SSH origin`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        gitId(repositoryPath, ["remote", "set-url", "origin", SSH_ORIGIN_URL]);
        await assert.rejects(
          () => invokePalSlot(slotId, { repositoryPath }),
          (error: Error & { code?: string }) =>
            error.code === "NYI" && error.message.includes("does not use network remotes"),
        );
      });
    });
  }

  it("fetchUpstream copies a local origin branch into FETCH_HEAD", async () => {
    await withLocalClone(async (originPath, localPath, branch) => {
      writeFileSync(join(originPath, "remote-golden.txt"), "fetched\n", "utf8");
      gitId(originPath, ["add", "remote-golden.txt"]);
      gitId(originPath, ["commit", "-m", "origin-advance"]);
      const originTip = gitId(originPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("remote.fetchUpstream", {
          repositoryPath: localPath,
          name: "origin",
          rev: branch,
        }),
        originTip,
      );
      assert.equal(gitId(localPath, ["rev-parse", "FETCH_HEAD"]), originTip);
      assert.equal(gitId(localPath, ["rev-parse", `refs/remotes/origin/${branch}`]), originTip);
    });
  });

  it("pushFf fast-forwards a bare local origin", async () => {
    await withBareClone(async (barePath, localPath, branch) => {
      writeFileSync(join(localPath, "remote-golden.txt"), "pushed\n", "utf8");
      gitId(localPath, ["add", "remote-golden.txt"]);
      gitId(localPath, ["commit", "-m", "local-advance"]);
      const localTip = gitId(localPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("remote.pushFf", {
          repositoryPath: localPath,
          name: "origin",
          rev: branch,
          newId: localTip,
        }),
        "",
      );
      assert.equal(gitId(barePath, ["rev-parse", `refs/heads/${branch}`]), localTip);
    });
  });

  it("commit after clone uses the helper git identity", async () => {
    await withBareClone(async (_barePath, localPath) => {
      const clonePath = mkdtempSync(join(tmpdir(), "grits-remote-clone-ident-"));
      rmSync(clonePath, { recursive: true, force: true });
      try {
        gitId(localPath, ["clone", localPath, clonePath]);
        writeFileSync(join(clonePath, "clone-ident.txt"), "clone-ident\n", "utf8");
        gitId(clonePath, ["add", "clone-ident.txt"]);
        gitId(clonePath, ["commit", "-m", "clone-ident"]);
        assert.match(gitId(clonePath, ["rev-parse", "HEAD"]), /^[0-9a-f]{40}$/);
      } finally {
        rmSync(clonePath, { recursive: true, force: true });
      }
    });
  });

  it("pushFf rejects a non-fast-forward update", async () => {
    await withBareClone(async (barePath, localPath, branch) => {
      const otherPath = mkdtempSync(join(tmpdir(), "grits-remote-other-"));
      rmSync(otherPath, { recursive: true, force: true });
      gitId(barePath, ["clone", barePath, otherPath]);
      writeFileSync(join(otherPath, "other.txt"), "other\n", "utf8");
      gitId(otherPath, ["add", "other.txt"]);
      gitId(otherPath, ["commit", "-m", "other-advance"]);
      gitId(otherPath, ["push", "origin", `HEAD:refs/heads/${branch}`]);
      writeFileSync(join(localPath, "remote-golden.txt"), "diverged\n", "utf8");
      gitId(localPath, ["add", "remote-golden.txt"]);
      gitId(localPath, ["commit", "-m", "local-diverge"]);
      await assert.rejects(
        () =>
          invokePalSlot("remote.pushFf", {
            repositoryPath: localPath,
            name: "origin",
            rev: branch,
            newId: gitId(localPath, ["rev-parse", "HEAD"]),
          }),
        (error: Error & { code?: string }) =>
          error.code === "INVALID_CONFIG" && error.message.startsWith("non-fast-forward:"),
      );
      rmSync(otherPath, { recursive: true, force: true });
    });
  });

  it("pushForceWithLease updates when oldId matches", async () => {
    await withBareClone(async (barePath, localPath, branch) => {
      const oldId = gitId(barePath, ["rev-parse", `refs/heads/${branch}`]);
      writeFileSync(join(localPath, "remote-golden.txt"), "leased\n", "utf8");
      gitId(localPath, ["add", "remote-golden.txt"]);
      gitId(localPath, ["commit", "-m", "lease-rewrite"]);
      const newId = gitId(localPath, ["rev-parse", "HEAD"]);
      assert.equal(
        await invokePalSlot("remote.pushForceWithLease", {
          repositoryPath: localPath,
          name: "origin",
          rev: branch,
          newId,
          oldId,
        }),
        "",
      );
      assert.equal(gitId(barePath, ["rev-parse", `refs/heads/${branch}`]), newId);
    });
  });

  it("pushForceWithLease rejects a stale oldId", async () => {
    await withBareClone(async (barePath, localPath, branch) => {
      const stale = gitId(localPath, ["rev-parse", "HEAD"]);
      writeFileSync(join(localPath, "remote-golden.txt"), "stale\n", "utf8");
      gitId(localPath, ["add", "remote-golden.txt"]);
      gitId(localPath, ["commit", "-m", "after-stale"]);
      gitId(localPath, ["push", "origin", `HEAD:refs/heads/${branch}`]);
      await assert.rejects(
        () =>
          invokePalSlot("remote.pushForceWithLease", {
            repositoryPath: localPath,
            name: "origin",
            rev: branch,
            newId: gitId(localPath, ["rev-parse", "HEAD"]),
            oldId: stale,
          }),
        (error: Error & { code?: string }) =>
          error.code === "INVALID_CONFIG" && error.message.startsWith("stale info:"),
      );
    });
  });
});

function withLocalClone<T>(
  run: (originPath: string, localPath: string, branch: string) => T | Promise<T>,
): Promise<T> {
  const originPath = mkdtempSync(join(tmpdir(), "grits-remote-origin-"));
  const localPath = mkdtempSync(join(tmpdir(), "grits-remote-local-"));
  rmSync(localPath, { recursive: true, force: true });
  return Promise.resolve()
    .then(() => {
      gitId(originPath, ["init"]);
      gitId(originPath, ["config", "user.email", "grits@example.test"]);
      gitId(originPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(originPath, "remote-golden.txt"), "golden-remote\n", "utf8");
      gitId(originPath, ["add", "remote-golden.txt"]);
      gitId(originPath, ["commit", "-m", "golden-remote"]);
      const branch = gitId(originPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      gitId(originPath, ["clone", originPath, localPath]);
      return run(originPath, localPath, branch);
    })
    .finally(() => {
      rmSync(originPath, { recursive: true, force: true });
      rmSync(localPath, { recursive: true, force: true });
    });
}

function withBareClone<T>(
  run: (barePath: string, localPath: string, branch: string) => T | Promise<T>,
): Promise<T> {
  const seedPath = mkdtempSync(join(tmpdir(), "grits-remote-seed-"));
  const barePath = mkdtempSync(join(tmpdir(), "grits-remote-bare-"));
  const localPath = mkdtempSync(join(tmpdir(), "grits-remote-push-"));
  rmSync(barePath, { recursive: true, force: true });
  rmSync(localPath, { recursive: true, force: true });
  return Promise.resolve()
    .then(() => {
      gitId(seedPath, ["init"]);
      gitId(seedPath, ["config", "user.email", "grits@example.test"]);
      gitId(seedPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(seedPath, "remote-golden.txt"), "golden-remote\n", "utf8");
      gitId(seedPath, ["add", "remote-golden.txt"]);
      gitId(seedPath, ["commit", "-m", "golden-remote"]);
      const branch = gitId(seedPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      gitId(seedPath, ["clone", "--bare", seedPath, barePath]);
      gitId(barePath, ["clone", barePath, localPath]);
      gitId(localPath, ["config", "user.email", "grits@example.test"]);
      gitId(localPath, ["config", "user.name", "Grits Test"]);
      return run(barePath, localPath, branch);
    })
    .finally(() => {
      rmSync(seedPath, { recursive: true, force: true });
      rmSync(barePath, { recursive: true, force: true });
      rmSync(localPath, { recursive: true, force: true });
    });
}
