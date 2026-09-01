import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { isGitRepository } from "./clone-local.js";
import { writePackIndex } from "./pack-read.js";
import { updateRefNoDeref } from "./refs.js";
import { gitDir, resolveRef } from "./resolve-head.js";
import {
  advertisedDefaultBranch,
  defaultFetch,
  lsRemoteHttps,
  type FetchLike,
  type RemoteRef,
} from "./smart-http-ls-remote.js";

const SERVICE = "git-upload-pack";
// gitprotocol-common: pkt-line length is four hex digits. Payload max is 65516 bytes, so the
// encoded line is at most 65520 bytes including the length header.
const PKT_LINE_MAX = 65520;
const PACK_SHA1_TRAILER_BYTES = 20;
const PACK_MAGIC = Buffer.from("PACK");

function fail(code: GritsError["code"], message: string): never {
  throw new GritsError(code, message, "fetchHttps");
}

function encodePkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  if (body.length + 4 > PKT_LINE_MAX) {
    fail("INVALID_CONFIG", "Smart HTTP want line exceeds the pkt-line maximum.");
  }
  const length = (body.length + 4).toString(16).padStart(4, "0");
  return Buffer.concat([Buffer.from(length, "ascii"), body]);
}

function readPktLines(buffer: Buffer): Array<Buffer | null> {
  const lines: Array<Buffer | null> = [];
  let offset = 0;
  while (offset + 4 <= buffer.length) {
    const lengthText = buffer.subarray(offset, offset + 4).toString("ascii");
    const length = Number.parseInt(lengthText, 16);
    if (!Number.isInteger(length) || length < 0) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP pack result has an invalid pkt-line length.");
    }
    if (length === 0) {
      lines.push(null);
      offset += 4;
      continue;
    }
    if (length < 4 || length > PKT_LINE_MAX || offset + length > buffer.length) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP pack result has an invalid pkt-line.");
    }
    lines.push(buffer.subarray(offset + 4, offset + length));
    offset += length;
  }
  if (offset !== buffer.length) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP pack result has trailing pkt-line bytes.");
  }
  return lines;
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
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP fetch found no refs to want.");
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

function buildFetchV2Body(heads: RemoteRef[]): Buffer {
  const oids = [...new Set(heads.map((ref) => ref.oid))];
  return Buffer.concat([
    encodePkt("command=fetch\n"),
    Buffer.from("0001", "ascii"),
    ...oids.map((oid) => encodePkt(`want ${oid}\n`)),
    encodePkt("ofs-delta\n"),
    encodePkt("no-progress\n"),
    encodePkt("done\n"),
    Buffer.from("0000", "ascii"),
  ]);
}

function unpackSidebandPack(buffer: Buffer): Buffer {
  const lines = readPktLines(buffer);
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
        `Smart HTTP fetch failed: ${line.subarray(1).toString("utf8").trim()}`,
      );
    }
    if (line.subarray(0, 4).equals(PACK_MAGIC)) {
      packChunks.push(line);
      continue;
    }
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP pack result is not a side-band pack.");
  }
  const pack = Buffer.concat(packChunks);
  if (pack.length < 12 + PACK_SHA1_TRAILER_BYTES || !pack.subarray(0, 4).equals(PACK_MAGIC)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP fetch did not return a pack.");
  }
  const trailer = pack.subarray(pack.length - PACK_SHA1_TRAILER_BYTES);
  const digest = createHash("sha1")
    .update(pack.subarray(0, pack.length - PACK_SHA1_TRAILER_BYTES))
    .digest();
  if (!trailer.equals(digest)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP fetch rejected a pack whose SHA-1 trailer does not match.");
  }
  return pack;
}

export async function fetchHttps(
  repositoryPath: string,
  repositoryUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  if (!isGitRepository(repositoryPath)) {
    fail("REPOSITORY_UNAVAILABLE", `Fetch destination ${repositoryPath} is not a git repository.`);
  }
  const advertised = await lsRemoteHttps(repositoryUrl, fetchImpl);
  const heads = headsToWant(advertised.refs);
  const url = repositoryUrl.replace(/\/+$/, "");
  const useV2 = advertised.protocol === 2;
  const headers: Record<string, string> = {
    "content-type": `application/x-${SERVICE}-request`,
    accept: `application/x-${SERVICE}-result`,
  };
  if (useV2) {
    headers["Git-Protocol"] = "version=2";
  }
  const response = await fetchImpl(`${url}/${SERVICE}`, {
    method: "POST",
    headers,
    body: new Uint8Array(useV2 ? buildFetchV2Body(heads) : buildWantBody(heads)),
  });
  if (response.status === 401) {
    fail("NYI", "NYI: fetchHttps does not send credentials.");
  }
  if (response.status !== 200) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP fetch did not return a pack.");
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(`application/x-${SERVICE}-result`)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP fetch is not a pack result.");
  }
  const pack = unpackSidebandPack(Buffer.from(await response.arrayBuffer()));
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
    await updateRefNoDeref(repositoryPath, `refs/remotes/origin/${branch}`, head.oid);
  }
}

export async function cloneHttps(
  destPath: string,
  repositoryUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  await mkdir(destPath, { recursive: true });
  const advertised = await lsRemoteHttps(repositoryUrl, fetchImpl);
  const branch = advertisedDefaultBranch(advertised);
  const dir = gitDir(destPath);
  await mkdir(join(dir, "objects"), { recursive: true });
  await mkdir(join(dir, "refs", "heads"), { recursive: true });
  await writeFile(join(dir, "HEAD"), `ref: refs/heads/${branch}\n`, "utf8");
  await writeFile(
    join(dir, "config"),
    `[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n[remote "origin"]\n\turl = ${repositoryUrl.replace(/\/+$/, "")}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "${branch}"]\n\tremote = origin\n\tmerge = refs/heads/${branch}\n`,
    "utf8",
  );
  await fetchHttps(destPath, repositoryUrl, fetchImpl);
  const tip = await resolveRef(destPath, `refs/remotes/origin/${branch}`);
  await updateRefNoDeref(destPath, `refs/heads/${branch}`, tip);
}
