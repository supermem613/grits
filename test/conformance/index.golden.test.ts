import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";
import { readIndex, writeIndex } from "../../src/internal/git-index.js";

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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-index-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      writeFileSync(join(repositoryPath, "index-golden.txt"), "golden-index\n", "utf8");
      gitId(repositoryPath, ["add", "index-golden.txt"]);
      gitId(repositoryPath, ["commit", "-m", "golden-index"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("index family goldens", () => {
  it("writeTree matches git write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      assert.equal(
        await invokePalSlot("index.writeTree", { repositoryPath }),
        gitId(repositoryPath, ["write-tree"]),
      );
    });
  });

  it("statusPorcelain is empty on a clean tree and is not the tree id", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
      assert.notEqual(status.trim(), treeId);
    });
  });

  it("statusPorcelain reports an untracked file", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "untracked.txt"), "new\n", "utf8");
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.match(status, /\?\? untracked\.txt/);
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
    });
  });

  it("statusPorcelain reports a worktree modification", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      const status = await invokePalSlot("index.statusPorcelain", { repositoryPath });
      assert.match(status, /index-golden\.txt/);
      assert.equal(status, git(repositoryPath, ["status", "--porcelain"]));
    });
  });

  it("updateIndexForceRemove drops the path from the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await invokePalSlot("index.updateIndexForceRemove", {
        repositoryPath,
        path: "index-golden.txt",
      });
      const names = git(repositoryPath, ["ls-files"]);
      assert.equal(names.includes("index-golden.txt"), false);
    });
  });

  it("statusFull uses NUL porcelain and is not write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusFull", { repositoryPath });
      assert.equal(status, git(repositoryPath, ["status", "--porcelain=v1", "-z"]));
      assert.notEqual(status.replaceAll("\0", "").trim(), treeId);
    });
  });

  it("statusFull reads a git index path whose length is 2 mod 8", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const names = ["aa", "bb", "cc"];
      for (const name of names) {
        writeFileSync(join(repositoryPath, name), `${name}\n`, "utf8");
        gitId(repositoryPath, ["add", name]);
      }
      gitId(repositoryPath, ["commit", "-m", "two-byte-paths"]);
      for (const name of names) {
        writeFileSync(join(repositoryPath, name), `${name}-dirty\n`, "utf8");
      }
      assert.equal(
        await invokePalSlot("index.statusFull", { repositoryPath }),
        git(repositoryPath, ["status", "--porcelain=v1", "-z"]),
      );
    });
  });

  it("readIndex returns git ls-files names for a DIRC v3 skip-worktree entry", async () => {
    await withOracleRepo(async (repositoryPath) => {
      gitId(repositoryPath, ["config", "index.version", "3"]);
      writeFileSync(join(repositoryPath, "tracked.txt"), "tracked\n", "utf8");
      gitId(repositoryPath, ["add", "tracked.txt"]);
      gitId(repositoryPath, ["commit", "-m", "dirc-v3"]);
      gitId(repositoryPath, ["update-index", "--skip-worktree", "tracked.txt"]);
      assert.deepEqual(
        (await readIndex(repositoryPath)).map((entry) => entry.name),
        git(repositoryPath, ["ls-files", "-z"]).split("\0").filter(Boolean),
      );
    });
  });

  it("readIndex returns the full path when DIRC name length is the 0xFFF sentinel", async () => {
    await withOracleRepo(async (repositoryPath) => {
      // 4096 bytes is past the 12-bit length field. Git stores 0xFFF and a NUL terminator.
      const longName = "n".repeat(4096);
      const nameBytes = Buffer.from(longName, "utf8");
      const entryLength = 63 + nameBytes.length;
      const padding = (8 - (entryLength % 8)) % 8;
      const header = Buffer.alloc(12);
      header.write("DIRC");
      header.writeUInt32BE(2, 4);
      header.writeUInt32BE(1, 8);
      const entry = Buffer.alloc(entryLength + padding);
      entry.writeUInt32BE(0o100644, 24);
      entry.writeUInt32BE(nameBytes.length, 36);
      entry.writeUInt16BE(0xfff, 60);
      nameBytes.copy(entry, 62);
      const body = Buffer.concat([header, entry]);
      writeFileSync(
        join(repositoryPath, ".git", "index"),
        Buffer.concat([body, createHash("sha1").update(body).digest()]),
      );
      assert.deepEqual(
        (await readIndex(repositoryPath)).map((item) => item.name),
        [longName],
      );
    });
  });

  it("writeIndex encodes a 0xFFF long name that git ls-files returns", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const longName = "n".repeat(4096);
      const blob = gitId(repositoryPath, ["hash-object", "index-golden.txt"]);
      await writeIndex(repositoryPath, [
        {
          mode: 0o100644,
          size: 13,
          id: blob,
          name: longName,
          stage: 0,
        },
      ]);
      assert.equal(
        readFileSync(join(repositoryPath, ".git", "index")).readUInt16BE(72) & 0xfff,
        0xfff,
      );
      assert.deepEqual(
        git(repositoryPath, ["ls-files", "-z"]).split("\0").filter(Boolean),
        [longName],
      );
    });
  });

  it("readIndex throws for a DIRC version outside 2 through 4", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const header = Buffer.alloc(12);
      header.write("DIRC");
      header.writeUInt32BE(5, 4);
      header.writeUInt32BE(0, 8);
      writeFileSync(
        join(repositoryPath, ".git", "index"),
        Buffer.concat([header, createHash("sha1").update(header).digest()]),
      );
      await assert.rejects(
        () => readIndex(repositoryPath),
        { message: "Unsupported git index version" },
      );
    });
  });

  it("readIndex returns git ls-files names for DIRC v4 prefix-compressed paths", async () => {
    await withOracleRepo(async (repositoryPath) => {
      gitId(repositoryPath, ["config", "index.version", "4"]);
      writeFileSync(join(repositoryPath, "src-a.txt"), "a\n", "utf8");
      writeFileSync(join(repositoryPath, "src-b.txt"), "b\n", "utf8");
      gitId(repositoryPath, ["add", "src-a.txt", "src-b.txt"]);
      gitId(repositoryPath, ["commit", "-m", "dirc-v4"]);
      gitId(repositoryPath, ["update-index", "--index-version", "4"]);
      assert.equal(readFileSync(join(repositoryPath, ".git", "index")).readUInt32BE(4), 4);
      assert.deepEqual(
        (await readIndex(repositoryPath)).map((entry) => entry.name),
        git(repositoryPath, ["ls-files", "-z"]).split("\0").filter(Boolean),
      );
    });
  });

  it("statusFull and statusBranch read the linked worktree gitdir index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const dest = mkdtempSync(join(tmpdir(), "grits-index-linked-dest-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        git(repositoryPath, ["config", "core.autocrlf", "false"]);
        git(repositoryPath, ["worktree", "add", "-b", "grits-linked-status", dest]);
        const [status, branchStatus] = await Promise.all([
          invokePalSlot("index.statusFull", { repositoryPath: dest }),
          invokePalSlot("index.statusBranch", { repositoryPath: dest }),
        ]);
        assert.equal(status, git(dest, ["status", "--porcelain=v1", "-z"]));
        const branch = gitId(dest, ["rev-parse", "--abbrev-ref", "HEAD"]);
        const headId = gitId(dest, ["rev-parse", "HEAD"]);
        assert.match(branchStatus, new RegExp(`# branch\\.head ${branch}`));
        assert.match(branchStatus, new RegExp(`# branch\\.oid ${headId}`));
      } finally {
        rmSync(dest, { recursive: true, force: true });
      }
    });
  });

  it("statusFullScoped limits status to one path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "dirty\n", "utf8");
      writeFileSync(join(repositoryPath, "other.txt"), "other\n", "utf8");
      gitId(repositoryPath, ["add", "other.txt"]);
      writeFileSync(join(repositoryPath, "other.txt"), "dirty-other\n", "utf8");
      const status = await invokePalSlot("index.statusFullScoped", {
        repositoryPath,
        path: "index-golden.txt",
      });
      assert.match(status, /index-golden\.txt/);
      assert.equal(status.includes("other.txt"), false);
    });
  });

  it("stagedNames lists cached path names", async () => {
    await withOracleRepo(async (repositoryPath) => {
      writeFileSync(join(repositoryPath, "index-golden.txt"), "staged\n", "utf8");
      gitId(repositoryPath, ["add", "index-golden.txt"]);
      assert.equal(
        await invokePalSlot("index.stagedNames", { repositoryPath }),
        git(repositoryPath, ["diff", "--cached", "--name-only", "-z", "--no-renames"]),
      );
    });
  });

  it("updateIndexInfo inserts a blob into the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "info\n");
      await invokePalSlot("index.updateIndexInfo", {
        repositoryPath,
        stdin: `100644 ${blob}\tinfo.txt\n`,
      });
      assert.match(git(repositoryPath, ["ls-files"]), /info\.txt/);
    });
  });

  it("updateIndexCacheinfo inserts a blob by oid and path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "cacheinfo\n");
      await invokePalSlot("index.updateIndexCacheinfo", {
        repositoryPath,
        path: "cacheinfo.txt",
        newId: blob,
      });
      assert.match(git(repositoryPath, ["ls-files"]), /cacheinfo\.txt/);
    });
  });

  it("statusBranch includes branch headers and is not write-tree", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["write-tree"]);
      const status = await invokePalSlot("index.statusBranch", { repositoryPath });
      const branch = gitId(repositoryPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const headId = gitId(repositoryPath, ["rev-parse", "HEAD"]);
      assert.match(status, new RegExp(`# branch\\.head ${branch}`));
      assert.match(status, new RegExp(`# branch\\.oid ${headId}`));
      assert.notEqual(branch, headId);
      assert.notEqual(status.replaceAll("\0", "").trim(), treeId);
    });
  });

  it("updateIndexForceRemovePathspec drops the path from the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await invokePalSlot("index.updateIndexForceRemovePathspec", {
        repositoryPath,
        path: "index-golden.txt",
      });
      assert.equal(git(repositoryPath, ["ls-files"]).includes("index-golden.txt"), false);
    });
  });

  it("readTree resets the index to HEAD", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const treeId = gitId(repositoryPath, ["rev-parse", "HEAD^{tree}"]);
      assert.equal(
        await invokePalSlot("index.readTree", { repositoryPath, rev: "HEAD" }),
        treeId,
      );
    });
  });

  it("checkout writes blob byte lengths into the index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      await invokePalSlot("worktree.checkout", { repositoryPath, target: "HEAD" });
      const debug = git(repositoryPath, ["ls-files", "--debug"]);
      assert.match(debug, /size: 13\t/);
      assert.equal(gitId(repositoryPath, ["hash-object", "index-golden.txt"]).length, 40);
    });
  });

  it("writeTree rejects an unmerged index", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const blob = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "stage\n");
      git(
        repositoryPath,
        ["update-index", "--index-info"],
        `100644 ${blob} 1\tindex-golden.txt\n100644 ${blob} 2\tindex-golden.txt\n100644 ${blob} 3\tindex-golden.txt\n`,
      );
      await assert.rejects(
        () => invokePalSlot("index.writeTree", { repositoryPath }),
        (error: Error & { code?: string }) => error.code === "INVALID_CONFIG",
      );
    });
  });
});
