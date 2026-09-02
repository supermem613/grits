import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { GritsError } from "../../src/api/errors.js";
import { createGrits } from "../../src/index.js";
import { fetchHttps } from "../../src/internal/smart-http-fetch.js";

const BLOB_TEXT = "packed-hello\n";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-smart-http-fetch-"));
  git(repositoryPath, ["init"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

function pkt(payload: Buffer | string): Buffer {
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, "utf8");
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function advertisement(commitId: string): Buffer {
  return Buffer.concat([
    pkt("# service=git-upload-pack\n"),
    Buffer.from("0000", "ascii"),
    pkt(`${commitId} HEAD\0multi_ack thin-pack ofs-delta side-band-64k symref=HEAD:refs/heads/main\n`),
    pkt(`${commitId} refs/heads/main\n`),
    Buffer.from("0000", "ascii"),
  ]);
}

function uploadPackResult(pack: Buffer): Buffer {
  // gitprotocol-common: pkt-line max is 65520 bytes including the 4-byte length.
  const maxPackBytes = 65520 - 4 - 1;
  const chunks: Buffer[] = [pkt("NAK\n")];
  for (let offset = 0; offset < pack.length; offset += maxPackBytes) {
    const slice = pack.subarray(offset, offset + maxPackBytes);
    chunks.push(pkt(Buffer.concat([Buffer.from([1]), slice])));
  }
  chunks.push(Buffer.from("0000", "ascii"));
  return Buffer.concat(chunks);
}

describe("Smart HTTP v1 anonymous fetch", () => {
  it("lets objects.read return a packed blob after fetching an oracle pack over HTTPS", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);
      git(sourcePath, ["repack", "-ad"]);
      git(sourcePath, ["prune-packed"]);
      const packDir = join(sourcePath, ".git", "objects", "pack");
      const packName = readdirSync(packDir).find((name) => name.endsWith(".pack"));
      assert.notEqual(packName, undefined);
      if (packName === undefined) {
        return;
      }
      const pack = readFileSync(join(packDir, packName));
      const posts: string[] = [];

      await withRepo(async (destPath) => {
        await fetchHttps(destPath, "https://example.test/grits.git", async (url, init) => {
          const method = init?.method ?? "GET";
          if (method === "GET") {
            return new Response(advertisement(commitId), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-advertisement",
              },
            });
          }
          posts.push(Buffer.from(init?.body ?? "").toString("utf8"));
          return new Response(uploadPackResult(pack), {
            status: 200,
            headers: {
              "content-type": "application/x-git-upload-pack-result",
            },
          });
        });

        assert.equal(posts.length, 1);
        assert.match(posts[0], new RegExp(`want ${commitId}`));
        assert.equal(posts[0].includes("thin-pack"), false);

        const grits = createGrits({
          repository: { kind: "filesystem", path: destPath },
        });
        const blob = await grits.objects.read(blobId);
        assert.deepEqual(blob, {
          kind: "blob",
          id: blobId,
          bytes: Array.from(Buffer.from(BLOB_TEXT)),
        });
        const tip = await grits.refs.resolve("refs/remotes/origin/main");
        assert.deepEqual(tip, {
          name: "refs/remotes/origin/main",
          objectId: commitId,
        });
      });
    });
  });
});

function v2Advertisement(): Buffer {
  return Buffer.concat([
    pkt("# service=git-upload-pack\n"),
    Buffer.from("0000", "ascii"),
    pkt("version 2\n"),
    pkt("ls-refs\n"),
    pkt("fetch\n"),
    Buffer.from("0000", "ascii"),
  ]);
}

function lsRefsResult(commitId: string): Buffer {
  return Buffer.concat([
    pkt(`${commitId} HEAD symref-target:refs/heads/main\n`),
    pkt(`${commitId} refs/heads/main\n`),
    Buffer.from("0000", "ascii"),
  ]);
}

function v2UploadPackResult(pack: Buffer): Buffer {
  const maxPackBytes = 65520 - 4 - 1;
  const chunks: Buffer[] = [pkt("packfile\n")];
  for (let offset = 0; offset < pack.length; offset += maxPackBytes) {
    const slice = pack.subarray(offset, offset + maxPackBytes);
    chunks.push(pkt(Buffer.concat([Buffer.from([1]), slice])));
  }
  chunks.push(Buffer.from("0000", "ascii"));
  return Buffer.concat(chunks);
}

describe("Smart HTTP v2 anonymous fetch", () => {
  it("lets objects.read return a packed blob after a protocol v2 fetch", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);
      git(sourcePath, ["repack", "-ad"]);
      git(sourcePath, ["prune-packed"]);
      const packDir = join(sourcePath, ".git", "objects", "pack");
      const packName = readdirSync(packDir).find((name) => name.endsWith(".pack"));
      assert.notEqual(packName, undefined);
      if (packName === undefined) {
        return;
      }
      const pack = readFileSync(join(packDir, packName));
      const posts: string[] = [];

      await withRepo(async (destPath) => {
        await fetchHttps(destPath, "https://example.test/grits.git", async (_url, init) => {
          const method = init?.method ?? "GET";
          const body = Buffer.from(init?.body ?? "").toString("utf8");
          if (method === "GET") {
            return new Response(v2Advertisement(), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-advertisement",
              },
            });
          }
          posts.push(body);
          if (body.includes("command=ls-refs")) {
            return new Response(lsRefsResult(commitId), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-result",
              },
            });
          }
          if (body.includes("command=fetch")) {
            return new Response(v2UploadPackResult(pack), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-result",
              },
            });
          }
          return new Response(Buffer.alloc(0), {
            status: 400,
            headers: {
              "content-type": "application/x-git-upload-pack-result",
            },
          });
        });

        assert.equal(posts.some((post) => post.includes("command=fetch")), true);
        assert.equal(posts.some((post) => post.includes("thin-pack")), false);
        const fetchPost = posts.find((post) => post.includes("command=fetch"));
        assert.notEqual(fetchPost, undefined);
        assert.match(fetchPost ?? "", new RegExp(`want ${commitId}`));

        const grits = createGrits({
          repository: { kind: "filesystem", path: destPath },
        });
        const blob = await grits.objects.read(blobId);
        assert.deepEqual(blob, {
          kind: "blob",
          id: blobId,
          bytes: Array.from(Buffer.from(BLOB_TEXT)),
        });
      });
    });
  });

  it("maps fetch pack HTTP 401 to AUTH", async () => {
    await withRepo(async (destPath) => {
      const commitId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
      await assert.rejects(
        () =>
          fetchHttps(destPath, "https://example.test/grits.git", async (_url, init) => {
            const method = init?.method ?? "GET";
            if (method === "GET") {
              return new Response(advertisement(commitId), {
                status: 200,
                headers: {
                  "content-type": "application/x-git-upload-pack-advertisement",
                },
              });
            }
            return new Response(null, { status: 401 });
          }),
        (error: Error) => {
          assert.equal(error instanceof GritsError, true);
          if (!(error instanceof GritsError)) {
            return false;
          }
          assert.equal(`${error.code}`, "AUTH");
          assert.equal(error.operation, "fetchHttps");
          assert.equal(error.message, "fetchHttps requires authentication.");
          return true;
        },
      );
    });
  });
});
