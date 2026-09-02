import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { isGitRepository } from "./clone-local.js";
import { writePackIndex } from "./pack-read.js";
import { writePack } from "./pack-write.js";
import { updateRefNoDeref } from "./refs.js";
import { gitDir, resolveRef } from "./resolve-head.js";
import {
  advertisedDefaultBranch,
  type LsRemoteResult,
  type RemoteRef,
} from "./smart-http-ls-remote.js";

const UPLOAD_PACK = "git-upload-pack";
const RECEIVE_PACK = "git-receive-pack";
const ZERO_OID = "0".repeat(40);
// gitprotocol-common: pkt-line length is four hex digits. Payload max is 65516 bytes, so the
// encoded line is at most 65520 bytes including the length header.
const PKT_LINE_MAX = 65520;
// pack-protocol: git:// default port is 9418.
const GIT_PROTOCOL_PORT = 9418;
const PACK_SHA1_TRAILER_BYTES = 20;
const PACK_MAGIC = Buffer.from("PACK");

function fail(code: GritsError["code"], message: string): never {
  throw new GritsError(code, message, "gitProtocol");
}

function encodePkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  if (body.length + 4 > PKT_LINE_MAX) {
    fail("INVALID_CONFIG", "git protocol want line exceeds the pkt-line maximum.");
  }
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function parseGitProtocolUrl(repositoryUrl: string): { host: string; port: number; path: string } {
  if (/^git:\/\/[^/]*@/i.test(repositoryUrl)) {
    fail("NYI", "NYI: git protocol does not send credentials.");
  }
  if (!/^git:\/\//i.test(repositoryUrl)) {
    fail("INVALID_CONFIG", "git protocol requires a git:// URL.");
  }
  let parsed: URL;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    fail("INVALID_CONFIG", "git protocol URL is not valid.");
  }
  const host = parsed.hostname;
  if (host.length === 0) {
    fail("INVALID_CONFIG", "git protocol URL is missing a host.");
  }
  const port = parsed.port.length === 0 ? GIT_PROTOCOL_PORT : Number(parsed.port);
  if (!Number.isInteger(port)) {
    fail("INVALID_CONFIG", "git protocol URL has an invalid port.");
  }
  const path = parsed.pathname.length === 0 ? "/" : parsed.pathname;
  return { host, port, path };
}

function headsToWant(refs: RemoteRef[]): RemoteRef[] {
  const heads = refs.filter(
    (ref) => ref.name.startsWith("refs/heads/") && !ref.name.endsWith("^{}"),
  );
  if (heads.length > 0) {
    return heads;
  }
  const head = refs.find((ref) => ref.name === "HEAD");
  if (head === undefined) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol fetch found no refs to want.");
  }
  return [head];
}

function buildWantBody(heads: RemoteRef[]): Buffer {
  const oids = [...new Set(heads.map((ref) => ref.oid))];
  const caps = "ofs-delta side-band-64k no-progress";
  const lines = oids.map((oid, index) =>
    index === 0 ? encodePkt(`want ${oid} ${caps}\n`) : encodePkt(`want ${oid}\n`),
  );
  return Buffer.concat([...lines, Buffer.from("0000", "ascii"), encodePkt("done\n")]);
}

function lineText(line: Buffer): string {
  return line.toString("utf8").replace(/\n$/, "");
}

function splitRef(line: string): RemoteRef {
  const space = line.indexOf(" ");
  if (space === -1) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol advertisement has a malformed ref.");
  }
  const oid = line.slice(0, space);
  const name = line.slice(space + 1).trim();
  if (!/^[0-9a-f]{40}$/i.test(oid) || name.length === 0) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol advertisement has a malformed ref.");
  }
  return { name, oid: oid.toLowerCase() };
}

function parseDaemonAdvertisement(lines: Array<Buffer | null>): LsRemoteResult {
  const refs: RemoteRef[] = [];
  const capabilities: string[] = [];
  let index = 0;
  while (index < lines.length && lines[index] === null) {
    index += 1;
  }
  const first = lines[index];
  if (first === undefined || first === null) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol advertisement is empty.");
  }
  const firstText = lineText(first);
  const nul = firstText.indexOf("\0");
  if (nul === -1) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol advertisement is missing capabilities.");
  }
  const firstRef = firstText.slice(0, nul);
  const capabilityText = firstText.slice(nul + 1).trim();
  if (capabilityText.length > 0) {
    capabilities.push(...capabilityText.split(" ").filter((value) => value.length > 0));
  }
  if (firstRef !== "0000000000000000000000000000000000000000 capabilities^{}") {
    refs.push(splitRef(firstRef));
  }
  index += 1;
  while (index < lines.length) {
    const line = lines[index];
    index += 1;
    if (line === null) {
      break;
    }
    refs.push(splitRef(lineText(line)));
  }
  return { refs, capabilities, protocol: 1 };
}

function unpackSidebandPack(buffer: Buffer): Buffer {
  const lines: Array<Buffer | null> = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const lengthText = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = Number.parseInt(lengthText, 16);
    if (!Number.isInteger(length) || length < 0) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol pack result has an invalid pkt-line length.");
    }
    if (length === 0) {
      lines.push(null);
      offset += 4;
      continue;
    }
    if (length < 4 || length > PKT_LINE_MAX || offset + length > buffer.length) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol pack result has an invalid pkt-line.");
    }
    lines.push(buffer.subarray(offset + 4, offset + length));
    offset += length;
  }
  if (offset !== buffer.length) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol pack result has trailing pkt-line bytes.");
  }
  const packChunks: Buffer[] = [];
  for (const line of lines) {
    if (line === null) {
      continue;
    }
    const text = line.toString("utf8").replace(/\n$/, "");
    if (text === "NAK" || text === "packfile" || text.startsWith("ACK ")) {
      continue;
    }
    const channel = line[0];
    if (channel === 1) {
      packChunks.push(line.subarray(1));
      continue;
    }
    if (channel === 2) {
      continue;
    }
    if (channel === 3) {
      fail(
        "REPOSITORY_UNAVAILABLE",
        `git protocol fetch failed: ${line.subarray(1).toString("utf8").trim()}`,
      );
    }
    if (line.subarray(0, 4).equals(PACK_MAGIC)) {
      packChunks.push(line);
      continue;
    }
    fail("REPOSITORY_UNAVAILABLE", "git protocol pack result is not a side-band pack.");
  }
  const pack = Buffer.concat(packChunks);
  if (pack.length < 12 + PACK_SHA1_TRAILER_BYTES || !pack.subarray(0, 4).equals(PACK_MAGIC)) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol fetch did not return a pack.");
  }
  const trailer = pack.subarray(pack.length - PACK_SHA1_TRAILER_BYTES);
  const digest = createHash("sha1")
    .update(pack.subarray(0, pack.length - PACK_SHA1_TRAILER_BYTES))
    .digest();
  if (!trailer.equals(digest)) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol fetch rejected a pack whose SHA-1 trailer does not match.");
  }
  return pack;
}

class GitTcpSession {
  private leftover = Buffer.alloc(0);
  private queue: Buffer[] = [];
  private ended = false;
  private waiter: ((chunk: Buffer | null) => void) | undefined;

  constructor(private readonly socket: Socket) {
    socket.on("data", (chunk) => {
      if (this.waiter !== undefined) {
        const waiter = this.waiter;
        this.waiter = undefined;
        waiter(chunk);
        return;
      }
      this.queue.push(chunk);
    });
    socket.on("end", () => {
      this.ended = true;
      if (this.waiter !== undefined) {
        const waiter = this.waiter;
        this.waiter = undefined;
        waiter(null);
      }
    });
    socket.on("error", (error) => {
      fail("REPOSITORY_UNAVAILABLE", `git protocol socket failed: ${error.message}`);
    });
  }

  write(buffer: Buffer): void {
    this.socket.write(buffer);
  }

  end(): void {
    this.socket.end();
  }

  async readPktLine(): Promise<Buffer | null> {
    const header = await this.readExact(4);
    const lengthText = header.toString("ascii");
    const length = Number.parseInt(lengthText, 16);
    if (!Number.isInteger(length) || length < 0) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol has an invalid pkt-line length.");
    }
    if (length === 0) {
      return null;
    }
    if (length < 4 || length > PKT_LINE_MAX) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol has an invalid pkt-line.");
    }
    return this.readExact(length - 4);
  }

  async readUntilEnd(): Promise<Buffer> {
    const chunks: Uint8Array[] = [this.leftover];
    this.leftover = Buffer.alloc(0);
    while (true) {
      const chunk = await this.readChunk();
      if (chunk === null) {
        break;
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  private async readExact(size: number): Promise<Buffer> {
    while (this.leftover.length < size) {
      const chunk = await this.readChunk();
      if (chunk === null) {
        fail("REPOSITORY_UNAVAILABLE", "git protocol closed before a pkt-line finished.");
      }
      this.leftover = Buffer.concat([this.leftover, chunk]);
    }
    const out = this.leftover.subarray(0, size);
    this.leftover = this.leftover.subarray(size);
    return out;
  }

  private readChunk(): Promise<Buffer | null> {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      return Promise.resolve(next ?? null);
    }
    if (this.ended) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      this.waiter = resolve;
    });
  }
}

async function connectGit(host: string, port: number): Promise<GitTcpSession> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const connected = connect({ host, port });
    connected.once("connect", () => {
      resolve(connected);
    });
    connected.once("error", reject);
  });
  return new GitTcpSession(socket);
}

function oldOidFor(refs: RemoteRef[], name: string): string {
  const match = refs.find((ref) => ref.name === name);
  return match?.oid ?? ZERO_OID;
}

function requireUnpackOk(buffer: Buffer): void {
  const lines: string[] = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const lengthText = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = Number.parseInt(lengthText, 16);
    if (!Number.isInteger(length) || length < 0) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol receive-pack has an invalid pkt-line length.");
    }
    if (length === 0) {
      offset += 4;
      continue;
    }
    if (length < 4 || length > PKT_LINE_MAX || offset + length > buffer.length) {
      fail("REPOSITORY_UNAVAILABLE", "git protocol receive-pack has an invalid pkt-line.");
    }
    lines.push(lineText(buffer.subarray(offset + 4, offset + length)));
    offset += length;
  }
  if (offset !== buffer.length) {
    fail("REPOSITORY_UNAVAILABLE", "git protocol receive-pack has trailing pkt-line bytes.");
  }
  if (!lines.includes("unpack ok")) {
    const error = lines.find((text) => text.startsWith("unpack ")) ?? lines[0] ?? "empty result";
    fail("REPOSITORY_UNAVAILABLE", `git protocol push unpack failed: ${error}`);
  }
}

async function lsRemoteGit(
  session: GitTcpSession,
  path: string,
  host: string,
  service: string = UPLOAD_PACK,
): Promise<LsRemoteResult> {
  session.write(encodePkt(`${service} ${path}\0host=${host}\0`));
  const lines: Array<Buffer | null> = [];
  while (true) {
    const line = await session.readPktLine();
    lines.push(line);
    if (line === null) {
      break;
    }
  }
  return parseDaemonAdvertisement(lines);
}

async function ingestPack(
  repositoryPath: string,
  pack: Buffer,
  heads: RemoteRef[],
  remoteName: string,
): Promise<void> {
  const packName = `pack-${pack.subarray(pack.length - PACK_SHA1_TRAILER_BYTES).toString("hex")}.pack`;
  const destDir = join(gitDir(repositoryPath), "objects", "pack");
  await mkdir(destDir, { recursive: true });
  const destPack = join(destDir, packName);
  if (existsSync(destPack) || existsSync(`${destPack.slice(0, -".pack".length)}.idx`)) {
    fail("REPOSITORY_UNAVAILABLE", `Fetch refuses to overwrite ${packName}.`);
  }
  await writeFile(destPack, pack, { flag: "wx" });
  try {
    await writePackIndex(destPack);
  } catch (error) {
    await unlink(destPack).catch(() => undefined);
    throw error;
  }
  for (const head of heads) {
    const branch = head.name.startsWith("refs/heads/")
      ? head.name.slice("refs/heads/".length)
      : "HEAD";
    await updateRefNoDeref(repositoryPath, `refs/remotes/${remoteName}/${branch}`, head.oid);
  }
}

export async function fetchGit(
  repositoryPath: string,
  repositoryUrl: string,
  remoteName: string,
): Promise<void> {
  if (!isGitRepository(repositoryPath)) {
    fail("REPOSITORY_UNAVAILABLE", `Fetch destination ${repositoryPath} is not a git repository.`);
  }
  const { host, port, path } = parseGitProtocolUrl(repositoryUrl);
  const session = await connectGit(host, port);
  try {
    const advertised = await lsRemoteGit(session, path, host);
    const heads = headsToWant(advertised.refs);
    session.write(buildWantBody(heads));
    const pack = unpackSidebandPack(await session.readUntilEnd());
    await ingestPack(repositoryPath, pack, heads, remoteName);
  } finally {
    session.end();
  }
}

export async function cloneGit(destPath: string, repositoryUrl: string): Promise<void> {
  const { host, port, path } = parseGitProtocolUrl(repositoryUrl);
  const session = await connectGit(host, port);
  try {
    const advertised = await lsRemoteGit(session, path, host);
    const branch = advertisedDefaultBranch(advertised);
    await mkdir(destPath, { recursive: true });
    const dir = gitDir(destPath);
    await mkdir(join(dir, "objects"), { recursive: true });
    await mkdir(join(dir, "refs", "heads"), { recursive: true });
    await writeFile(join(dir, "HEAD"), `ref: refs/heads/${branch}\n`, "utf8");
    await writeFile(
      join(dir, "config"),
      `[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n[remote "origin"]\n\turl = ${repositoryUrl.replace(/\/+$/, "")}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "${branch}"]\n\tremote = origin\n\tmerge = refs/heads/${branch}\n`,
      "utf8",
    );
    const heads = headsToWant(advertised.refs);
    session.write(buildWantBody(heads));
    const pack = unpackSidebandPack(await session.readUntilEnd());
    await ingestPack(destPath, pack, heads, "origin");
    const tip = await resolveRef(destPath, `refs/remotes/origin/${branch}`);
    await updateRefNoDeref(destPath, `refs/heads/${branch}`, tip);
  } finally {
    session.end();
  }
}

export async function pushGit(
  repositoryPath: string,
  repositoryUrl: string,
  branch: string,
  sha: string,
): Promise<void> {
  if (!isGitRepository(repositoryPath)) {
    fail("REPOSITORY_UNAVAILABLE", `Push source ${repositoryPath} is not a git repository.`);
  }
  const { host, port, path } = parseGitProtocolUrl(repositoryUrl);
  const ref = `refs/heads/${branch}`;
  const oid = sha.length === 0 ? await resolveRef(repositoryPath, ref) : sha;
  const session = await connectGit(host, port);
  try {
    const advertised = await lsRemoteGit(session, path, host, RECEIVE_PACK);
    const packPath = join(tmpdir(), `grits-git-push-${randomBytes(8).toString("hex")}.pack`);
    await writePack(repositoryPath, [oid], packPath);
    let pack: Buffer;
    try {
      pack = await readFile(packPath);
    } finally {
      if (existsSync(packPath)) {
        await unlink(packPath);
      }
    }
    const command = encodePkt(`${oldOidFor(advertised.refs, ref)} ${oid} ${ref}\0report-status\n`);
    session.write(Buffer.concat([command, Buffer.from("0000", "ascii"), pack]));
    requireUnpackOk(await session.readUntilEnd());
  } finally {
    session.end();
  }
}
