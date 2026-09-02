import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { GritsError } from "../../src/api/errors.js";
import { createGrits } from "../../src/index.js";
import { writePackIndex } from "../../src/internal/pack-read.js";
import { pushHttps } from "../../src/internal/smart-http-push.js";

const BLOB_TEXT = "packed-hello\n";
const ZERO = "0".repeat(40);

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", [...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-smart-http-push-"));
  git(repositoryPath, ["init", "-b", "main"]);
  git(repositoryPath, ["config", "user.email", "grits@example.test"]);
  git(repositoryPath, ["config", "user.name", "Grits Test"]);
  return run(repositoryPath).finally(() => {
    rmSync(repositoryPath, { recursive: true, force: true });
  });
}

function pkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function advertisement(): Buffer {
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

describe("Smart HTTP v1 anonymous push", () => {
  it("sends an undeltified pack that objects.read can load on the receiving side", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);
      const posts: Buffer[] = [];

      await pushHttps(sourcePath, "https://example.test/grits.git", async (url, init) => {
        const method = init?.method ?? "GET";
        if (method === "GET") {
          assert.match(url, /info\/refs\?service=git-receive-pack$/);
          return new Response(advertisement(), {
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
      });

      assert.equal(posts.length, 1);
      const command = posts[0].toString("utf8");
      assert.match(command, new RegExp(`${ZERO} ${commitId} refs/heads/main`));
      assert.equal(command.includes("thin-pack"), false);

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

  it("maps receive-pack advertisement HTTP 401 to AUTH", async () => {
    await withRepo(async (sourcePath) => {
      await assert.rejects(
        () =>
          pushHttps(sourcePath, "https://example.test/grits.git", async () => {
            return new Response(null, { status: 401 });
          }),
        (error: Error) => {
          assert.equal(error instanceof GritsError, true);
          if (!(error instanceof GritsError)) {
            return false;
          }
          assert.equal(`${error.code}`, "AUTH");
          assert.equal(error.operation, "pushHttps");
          assert.equal(error.message, "pushHttps requires authentication.");
          return true;
        },
      );
    });
  });

  it("maps receive-pack result HTTP 401 to AUTH", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "packed-hello"]);
      await assert.rejects(
        () =>
          pushHttps(sourcePath, "https://example.test/grits.git", async (_url, init) => {
            const method = init?.method ?? "GET";
            if (method === "GET") {
              return new Response(advertisement(), {
                status: 200,
                headers: {
                  "content-type": "application/x-git-receive-pack-advertisement",
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
          assert.equal(error.operation, "pushHttps");
          assert.equal(error.message, "pushHttps requires authentication.");
          return true;
        },
      );
    });
  });
});
