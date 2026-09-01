import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { createGrits } from "../../src/index.js";
import { writePackIndex } from "../../src/internal/pack-read.js";
import { cloneHttps } from "../../src/internal/clone-local.js";
import { fetchUpstream, pushFf } from "../../src/internal/remote-sync.js";

const BLOB_TEXT = "packed-hello\n";

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pal-https-"));
  git(repositoryPath, ["init", "-b", "main"]);
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

function advertisement(commitId: string, branch = "main"): Buffer {
  return Buffer.concat([
    pkt("# service=git-upload-pack\n"),
    Buffer.from("0000", "ascii"),
    pkt(`${commitId} HEAD\0multi_ack thin-pack ofs-delta side-band-64k symref=HEAD:refs/heads/${branch}\n`),
    pkt(`${commitId} refs/heads/${branch}\n`),
    Buffer.from("0000", "ascii"),
  ]);
}

function uploadPackResult(pack: Buffer): Buffer {
  const maxPackBytes = 65520 - 4 - 1;
  const chunks: Buffer[] = [pkt("NAK\n")];
  for (let offset = 0; offset < pack.length; offset += maxPackBytes) {
    const slice = pack.subarray(offset, offset + maxPackBytes);
    chunks.push(pkt(Buffer.concat([Buffer.from([1]), slice])));
  }
  chunks.push(Buffer.from("0000", "ascii"));
  return Buffer.concat(chunks);
}

describe("PAL HTTPS remotes", () => {
  it("fetchUpstream loads a packed blob from an anonymous HTTPS origin", async () => {
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

      await withRepo(async (destPath) => {
        git(destPath, ["remote", "add", "origin", "https://example.test/grits.git"]);
        const tip = await fetchUpstream(
          destPath,
          "origin",
          "main",
          async (url, init) => {
            const method = init?.method ?? "GET";
            if (method === "GET") {
              return new Response(advertisement(commitId), {
                status: 200,
                headers: {
                  "content-type": "application/x-git-upload-pack-advertisement",
                },
              });
            }
            return new Response(uploadPackResult(pack), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-result",
              },
            });
          },
        );
        assert.equal(tip, commitId);
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

  it("pushFf sends an undeltified pack to an anonymous HTTPS origin", async () => {
    const ZERO = "0".repeat(40);
    function receiveAdvertisement(): Buffer {
      return Buffer.concat([
        pkt("# service=git-receive-pack\n"),
        Buffer.from("0000", "ascii"),
        pkt(`${ZERO} capabilities^{}\0report-status delete-refs ofs-delta\n`),
        Buffer.from("0000", "ascii"),
      ]);
    }
    function unpackOk(): Buffer {
      return Buffer.concat([
        pkt("unpack ok\n"),
        pkt("ok refs/heads/main\n"),
        Buffer.from("0000", "ascii"),
      ]);
    }
    function packFromPushBody(body: Uint8Array): Buffer {
      const buffer = Buffer.from(body);
      let offset = 0;
      while (offset + 4 <= buffer.length) {
        const length = Number.parseInt(buffer.subarray(offset, offset + 4).toString("ascii"), 16);
        if (length === 0) {
          return buffer.subarray(offset + 4);
        }
        offset += length;
      }
      throw new Error("Push body has no pack after the command flush.");
    }

    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);
      git(sourcePath, ["remote", "add", "origin", "https://example.test/grits.git"]);
      const posts: Buffer[] = [];

      await pushFf(
        sourcePath,
        "origin",
        "main",
        commitId,
        async (url, init) => {
          const method = init?.method ?? "GET";
          if (method === "GET") {
            return new Response(receiveAdvertisement(), {
              status: 200,
              headers: {
                "content-type": "application/x-git-receive-pack-advertisement",
              },
            });
          }
          posts.push(Buffer.from(init?.body ?? new Uint8Array()));
          return new Response(unpackOk(), {
            status: 200,
            headers: {
              "content-type": "application/x-git-receive-pack-result",
            },
          });
        },
      );

      assert.equal(posts.length, 1);
      await withRepo(async (destPath) => {
        const destPackDir = join(destPath, ".git", "objects", "pack");
        mkdirSync(destPackDir, { recursive: true });
        const packPath = join(destPackDir, "pack-from-push.pack");
        writeFileSync(packPath, packFromPushBody(posts[0]));
        await writePackIndex(packPath);
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

  it("cloneHttps loads a packed blob into a new repository", async () => {
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
      const destPath = mkdtempSync(join(tmpdir(), "grits-pal-https-clone-"));
      try {
        await cloneHttps(destPath, "https://example.test/grits.git", async (_url, init) => {
          const method = init?.method ?? "GET";
          if (method === "GET") {
            return new Response(advertisement(commitId), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-advertisement",
              },
            });
          }
          return new Response(uploadPackResult(pack), {
            status: 200,
            headers: {
              "content-type": "application/x-git-upload-pack-result",
            },
          });
        });
        const grits = createGrits({
          repository: { kind: "filesystem", path: destPath },
        });
        const blob = await grits.objects.read(blobId);
        assert.deepEqual(blob, {
          kind: "blob",
          id: blobId,
          bytes: Array.from(Buffer.from(BLOB_TEXT)),
        });
      } finally {
        rmSync(destPath, { recursive: true, force: true });
      }
    });
  });

  it("cloneHttps checks out the advertised default branch", async () => {
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
      const destPath = mkdtempSync(join(tmpdir(), "grits-pal-https-clone-master-"));
      try {
        await cloneHttps(destPath, "https://example.test/grits.git", async (_url, init) => {
          const method = init?.method ?? "GET";
          if (method === "GET") {
            return new Response(advertisement(commitId, "master"), {
              status: 200,
              headers: {
                "content-type": "application/x-git-upload-pack-advertisement",
              },
            });
          }
          return new Response(uploadPackResult(pack), {
            status: 200,
            headers: {
              "content-type": "application/x-git-upload-pack-result",
            },
          });
        });
        // Advertised name is the specification. Clone must not hard-code main.
        assert.equal(readFileSync(join(destPath, ".git", "HEAD"), "utf8"), "ref: refs/heads/master\n");
        const grits = createGrits({
          repository: { kind: "filesystem", path: destPath },
        });
        assert.deepEqual(await grits.refs.resolve("refs/heads/master"), {
          name: "refs/heads/master",
          objectId: commitId,
        });
        const blob = await grits.objects.read(blobId);
        assert.deepEqual(blob, {
          kind: "blob",
          id: blobId,
          bytes: Array.from(Buffer.from(BLOB_TEXT)),
        });
      } finally {
        rmSync(destPath, { recursive: true, force: true });
      }
    });
  });
});
