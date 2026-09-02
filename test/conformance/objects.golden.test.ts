import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const MAPPED_OBJECT_SLOTS = [
  "objects.catBlob",
  "objects.showBlob",
  "objects.showBlobAsync",
] as const;

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
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-objects-golden-"));
  return Promise.resolve()
    .then(() => {
      gitId(repositoryPath, ["init"]);
      gitId(repositoryPath, ["config", "user.email", "grits@example.test"]);
      gitId(repositoryPath, ["config", "user.name", "Grits Test"]);
      return run(repositoryPath);
    })
    .finally(() => {
      rmSync(repositoryPath, { recursive: true, force: true });
    });
}

describe("objects family goldens", () => {
  it("hashObjectNoWrite matches git hash-object --stdin and does not write", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const oracleId = gitId(repositoryPath, ["hash-object", "--stdin"], "golden-blob\n");
      const id = await invokePalSlot("objects.hashObjectNoWrite", {
        repositoryPath,
        stdin: "golden-blob\n",
      });
      assert.equal(id, oracleId);
      let missing = "gone";
      try {
        gitId(repositoryPath, ["cat-file", "-t", id]);
        missing = "present";
      } catch {
        missing = "gone";
      }
      assert.equal(missing, "gone");
    });
  });

  it("hashObjectStdin writes the blob", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const oracleId = gitId(repositoryPath, ["hash-object", "--stdin"], "golden-blob\n");
      const id = await invokePalSlot("objects.hashObjectStdin", {
        repositoryPath,
        stdin: "golden-blob\n",
      });
      assert.equal(id, oracleId);
      assert.equal(gitId(repositoryPath, ["cat-file", "-t", id]), "blob");
    });
  });

  it("hashObjectForPath hashes the file at path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(repositoryPath, "path-blob.txt"), "golden-blob\n", "utf8");
      const oracleId = gitId(repositoryPath, ["hash-object", "--path=path-blob.txt", "--stdin"], "golden-blob\n");
      assert.equal(
        await invokePalSlot("objects.hashObjectForPath", {
          repositoryPath,
          path: "path-blob.txt",
          stdin: "golden-blob\n",
        }),
        oracleId,
      );
    });
  });

  it("hashObjectForPathNoWrite hashes the file and does not write", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(repositoryPath, "path-blob.txt"), "golden-blob\n", "utf8");
      const oracleId = gitId(repositoryPath, ["hash-object", "path-blob.txt"]);
      const id = await invokePalSlot("objects.hashObjectForPathNoWrite", {
        repositoryPath,
        path: "path-blob.txt",
        stdin: "",
      });
      assert.equal(id, oracleId);
      let missing = "gone";
      try {
        gitId(repositoryPath, ["cat-file", "-t", id]);
        missing = "present";
      } catch {
        missing = "gone";
      }
      assert.equal(missing, "gone");
    });
  });

  it("hashObjectWriteBatch hashes each path", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(repositoryPath, "a.txt"), "a\n", "utf8");
      writeFileSync(join(repositoryPath, "b.txt"), "b\n", "utf8");
      const ids = await invokePalSlot("objects.hashObjectWriteBatch", {
        repositoryPath,
        stdin: "",
        paths: ["a.txt", "b.txt"],
      });
      const expected = [
        gitId(repositoryPath, ["hash-object", "a.txt"]),
        gitId(repositoryPath, ["hash-object", "b.txt"]),
      ].join("\n");
      assert.equal(ids, expected);
    });
  });

  it("hashObjectWriteBatchAsync matches hashObjectWriteBatch", async () => {
    await withOracleRepo(async (repositoryPath) => {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(join(repositoryPath, "a.txt"), "a\n", "utf8");
      writeFileSync(join(repositoryPath, "b.txt"), "b\n", "utf8");
      const ids = await invokePalSlot("objects.hashObjectWriteBatchAsync", {
        repositoryPath,
        stdin: "",
        paths: ["a.txt", "b.txt"],
      });
      const expected = [
        gitId(repositoryPath, ["hash-object", "a.txt"]),
        gitId(repositoryPath, ["hash-object", "b.txt"]),
      ].join("\n");
      assert.equal(ids, expected);
      assert.equal(gitId(repositoryPath, ["cat-file", "-t", ids.split("\n")[0]]), "blob");
    });
  });

  for (const slotId of MAPPED_OBJECT_SLOTS) {
    it(`spawns git then matches objects.read for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const objectId = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "golden-blob\n");
        const oracleBytes = git(repositoryPath, ["cat-file", "-p", objectId]);
        assert.equal(
          await gritsGit.catBlob({ repositoryPath, rev: objectId }),
          oracleBytes,
        );
        assert.equal(
          await gritsGit.catBlob({
            repository: {
              kind: "memory",
              seed: {
                objects: [
                  {
                    kind: "blob",
                    id: objectId,
                    bytes: Array.from(Buffer.from("golden-blob\n")),
                  },
                ],
              },
            },
            rev: objectId,
          }),
          oracleBytes,
        );
      });
    });
  }
});
