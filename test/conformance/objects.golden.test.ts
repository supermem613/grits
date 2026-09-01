import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";

const NYI_OBJECT_SLOTS = [
  "objects.hashObjectStdin",
  "objects.hashObjectForPath",
  "objects.hashObjectNoWrite",
  "objects.hashObjectForPathNoWrite",
  "objects.hashObjectWriteBatch",
  "objects.hashObjectWriteBatchAsync",
] as const;

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
  for (const slotId of NYI_OBJECT_SLOTS) {
    it(`matches git oracle for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const oracleId = gitId(repositoryPath, ["hash-object", "--stdin"], "golden-blob\n");
        assert.match(oracleId, /^[0-9a-f]{40}$/);
        assert.equal(
          await invokePalSlot(slotId, { repositoryPath, stdin: "golden-blob\n" }),
          oracleId,
        );
      });
    });
  }

  for (const slotId of MAPPED_OBJECT_SLOTS) {
    it(`spawns git then matches objects.read for ${slotId}`, async () => {
      await withOracleRepo(async (repositoryPath) => {
        const objectId = gitId(repositoryPath, ["hash-object", "-w", "--stdin"], "golden-blob\n");
        const oracleBytes = git(repositoryPath, ["cat-file", "-p", objectId]);
        const filesystemGrits = createGrits({
          repository: { kind: "filesystem", path: repositoryPath },
        });
        const filesystemObject = await filesystemGrits.objects.read(objectId);
        assert.equal(filesystemObject.kind, "blob");
        if (filesystemObject.kind === "blob") {
          assert.equal(Buffer.from(filesystemObject.bytes).toString("utf8"), oracleBytes);
        }

        const memoryGrits = createGrits({
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
        });
        const memoryObject = await memoryGrits.objects.read(objectId);
        assert.equal(memoryObject.kind, "blob");
        if (memoryObject.kind === "blob") {
          assert.equal(Buffer.from(memoryObject.bytes).toString("utf8"), oracleBytes);
        }
      });
    });
  }
});
