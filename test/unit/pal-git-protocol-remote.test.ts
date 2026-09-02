import { execFileSync } from "node:child_process";
import { createServer, type AddressInfo, type Socket } from "node:net";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { git as gritsGit } from "../../src/index.js";
import { invokePalSlot } from "../../src/conformance/pal-surface-registry.js";
import { writePackIndex } from "../../src/internal/pack-read.js";
import { isRuntimeString } from "../../src/internal/runtime-type.js";

const BLOB_TEXT = "git-proto-hello\n";

function tcpListenPort(address: string | AddressInfo | null): number {
  if (address === null) {
    throw new Error("listen did not bind a TCP port");
  }
  if (isRuntimeString(address)) {
    throw new Error("listen bound a pipe path");
  }
  return address.port;
}

function git(repositoryPath: string, args: readonly string[]): string {
  return execFileSync("git", ["-c", "safe.bareRepository=all", ...args], {
    cwd: repositoryPath,
    encoding: "utf8",
  }).trim();
}

function withRepo<T>(run: (repositoryPath: string) => Promise<T>): Promise<T> {
  const repositoryPath = mkdtempSync(join(tmpdir(), "grits-pal-git-proto-"));
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

function receiveAdvertisement(): Buffer {
  const ZERO = "0".repeat(40);
  return Buffer.concat([
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

function packFromPushBody(body: Buffer): Buffer {
  let offset = 0;
  while (offset + 4 <= body.length) {
    const length = Number.parseInt(body.subarray(offset, offset + 4).toString("ascii"), 16);
    if (length === 0) {
      return body.subarray(offset + 4);
    }
    offset += length;
  }
  throw new Error("Push body has no pack after the command flush.");
}

function updateCommandFromPushBody(body: Buffer): string {
  let offset = 0;
  let skippedRequest = false;
  while (offset + 4 <= body.length) {
    const length = Number.parseInt(body.subarray(offset, offset + 4).toString("ascii"), 16);
    if (length === 0) {
      throw new Error("Push body has no update command.");
    }
    const payload = body.subarray(offset + 4, offset + length).toString("utf8");
    if (!skippedRequest) {
      skippedRequest = true;
      offset += length;
      continue;
    }
    return payload.replace(/\0[\s\S]*$/, "").trim();
  }
  throw new Error("Push body has no update command.");
}

function listenGitReceivePack(): Promise<{
  url: string;
  close: () => Promise<void>;
  pushed: () => Buffer | undefined;
  command: () => string | undefined;
}> {
  let captured: Buffer | undefined;
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      const chunks: Buffer[] = [];
      let sentAdvert = false;
      socket.on("data", (data) => {
        chunks.push(data);
        const buf = Buffer.concat(chunks);
        if (!sentAdvert && buf.includes(Buffer.from("git-receive-pack", "utf8"))) {
          sentAdvert = true;
          socket.write(receiveAdvertisement());
          return;
        }
        if (sentAdvert && buf.includes(Buffer.from("PACK"))) {
          captured = buf;
          socket.write(unpackOk());
          socket.end();
        }
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = tcpListenPort(server.address());
      resolve({
        url: `git://127.0.0.1:${port}/grits.git`,
        pushed: () => (captured === undefined ? undefined : packFromPushBody(captured)),
        command: () => (captured === undefined ? undefined : updateCommandFromPushBody(captured)),
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

function listenGitUploadPack(advert: Buffer, packResult: Buffer): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((socket: Socket) => {
      const chunks: Buffer[] = [];
      let sentAdvert = false;
      socket.on("data", (data) => {
        chunks.push(data);
        const buf = Buffer.concat(chunks);
        if (!sentAdvert && buf.includes(Buffer.from("git-upload-pack", "utf8"))) {
          sentAdvert = true;
          socket.write(advert);
        }
        if (sentAdvert && buf.includes(Buffer.from("done\n", "utf8"))) {
          socket.write(packResult);
          socket.end();
        }
      });
    });
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = tcpListenPort(server.address());
      resolve({
        url: `git://127.0.0.1:${port}/grits.git`,
        close: () =>
          new Promise((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}

describe("PAL git protocol remotes", () => {
  it("clone copies a packed blob from an anonymous git URL", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "git-proto-hello"]);
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
      const daemon = await listenGitUploadPack(advertisement(commitId), uploadPackResult(pack));
      const dest = mkdtempSync(join(tmpdir(), "grits-pal-git-proto-clone-"));
      rmSync(dest, { recursive: true, force: true });
      try {
        assert.equal(
          await invokePalSlot("bootstrap.clone", {
            repositoryPath: sourcePath,
            path: daemon.url,
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
        await daemon.close();
      }
    });
  });

  it("fetchUpstream loads a packed blob from an anonymous git URL origin", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "git-proto-hello"]);
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
      const daemon = await listenGitUploadPack(advertisement(commitId), uploadPackResult(pack));
      try {
        await withRepo(async (destPath) => {
          git(destPath, ["remote", "add", "upstream", daemon.url]);
          const tip = await invokePalSlot("remote.fetchUpstream", {
            repositoryPath: destPath,
            name: "upstream",
            rev: "main",
          });
          assert.equal(tip, commitId);
          assert.equal(git(destPath, ["rev-parse", "refs/remotes/upstream/main"]), commitId);
          assert.equal(
          await gritsGit.catBlob({ repositoryPath: destPath, rev: blobId }),
          BLOB_TEXT,
        );
        });
      } finally {
        await daemon.close();
      }
    });
  });

  it("pushFf sends an undeltified pack to an anonymous git URL origin", async () => {
    await withRepo(async (sourcePath) => {
      writeFileSync(join(sourcePath, "file.txt"), BLOB_TEXT, "utf8");
      git(sourcePath, ["add", "file.txt"]);
      git(sourcePath, ["commit", "-m", "git-proto-hello"]);
      const blobId = git(sourcePath, ["rev-parse", "HEAD:file.txt"]);
      const commitId = git(sourcePath, ["rev-parse", "HEAD"]);
      const daemon = await listenGitReceivePack();
      git(sourcePath, ["checkout", "-b", "other"]);
      git(sourcePath, ["remote", "add", "origin", daemon.url]);
      try {
        assert.equal(
          await invokePalSlot("remote.pushFf", {
            repositoryPath: sourcePath,
            name: "origin",
            rev: "main",
            newId: commitId,
          }),
          "",
        );
        assert.equal(daemon.command(), `${"0".repeat(40)} ${commitId} refs/heads/main`);
        const pack = daemon.pushed();
        assert.notEqual(pack, undefined);
        if (pack === undefined) {
          return;
        }
        await withRepo(async (destPath) => {
          const destPackDir = join(destPath, ".git", "objects", "pack");
          mkdirSync(destPackDir, { recursive: true });
          const packPath = join(destPackDir, "pack-from-push.pack");
          writeFileSync(packPath, pack);
          await writePackIndex(packPath);
          assert.equal(
          await gritsGit.catBlob({ repositoryPath: destPath, rev: blobId }),
          BLOB_TEXT,
        );
        });
      } finally {
        await daemon.close();
      }
    });
  });
});
