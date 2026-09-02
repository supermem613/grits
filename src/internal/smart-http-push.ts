import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { isGitRepository } from "./clone-local.js";
import { writePack } from "./pack-write.js";
import { gitDir, resolveRef } from "./resolve-head.js";
import { defaultFetch, type FetchLike, type RemoteRef } from "./smart-http-ls-remote.js";

const SERVICE = "git-receive-pack";
const PKT_LINE_MAX = 65520;
const ZERO_OID = "0".repeat(40);

function fail(code: GritsError["code"], message: string): never {
  throw new GritsError(code, message, "pushHttps");
}

function normalizeHttpUrl(repositoryUrl: string): string {
  if (/^https?:\/\/[^/@]+@/i.test(repositoryUrl)) {
    fail("NYI", "NYI: pushHttps does not send credentials.");
  }
  if (!/^https?:\/\//i.test(repositoryUrl)) {
    fail("INVALID_CONFIG", "pushHttps requires an http or https URL.");
  }
  return repositoryUrl.replace(/\/+$/, "");
}

function encodePkt(payload: string): Buffer {
  const body = Buffer.from(payload, "utf8");
  if (body.length + 4 > PKT_LINE_MAX) {
    fail("INVALID_CONFIG", "Smart HTTP push command exceeds the pkt-line maximum.");
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
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack has an invalid pkt-line length.");
    }
    if (length === 0) {
      lines.push(null);
      offset += 4;
      continue;
    }
    if (length < 4 || length > PKT_LINE_MAX || offset + length > buffer.length) {
      fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack has an invalid pkt-line.");
    }
    lines.push(buffer.subarray(offset + 4, offset + length));
    offset += length;
  }
  if (offset !== buffer.length) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack has trailing pkt-line bytes.");
  }
  return lines;
}

function lineText(line: Buffer): string {
  return line.toString("utf8").replace(/\n$/, "");
}

function splitRef(line: string): RemoteRef {
  const space = line.indexOf(" ");
  if (space === -1) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack advertisement has a malformed ref.");
  }
  const oid = line.slice(0, space);
  const name = line.slice(space + 1).trim();
  if (!/^[0-9a-f]{40}$/i.test(oid) || name.length === 0) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack advertisement has a malformed ref.");
  }
  return { name, oid: oid.toLowerCase() };
}

function parseAdvertisement(buffer: Buffer): RemoteRef[] {
  const lines = readPktLines(buffer);
  let index = 0;
  while (index < lines.length && lines[index] === null) {
    index += 1;
  }
  const banner = lines[index];
  if (banner === undefined || banner === null) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP receive-pack advertisement is empty.");
  }
  const bannerText = lineText(banner);
  if (bannerText.includes("version 2")) {
    fail("NYI", "NYI: Git protocol v2 advertisements are not read.");
  }
  if (bannerText !== `# service=${SERVICE}`) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is not git-receive-pack.");
  }
  index += 1;
  if (lines[index] !== null) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is missing the service flush.");
  }
  index += 1;
  const refs: RemoteRef[] = [];
  const first = lines[index];
  if (first === undefined || first === null) {
    return refs;
  }
  const firstText = lineText(first);
  if (firstText.includes("version 2")) {
    fail("NYI", "NYI: Git protocol v2 advertisements are not read.");
  }
  const nul = firstText.indexOf("\0");
  if (nul === -1) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP advertisement is missing capabilities.");
  }
  const firstRef = firstText.slice(0, nul);
  if (firstRef !== `${ZERO_OID} capabilities^{}`) {
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
  return refs;
}

async function currentHead(repositoryPath: string): Promise<{ name: string; oid: string }> {
  const raw = (await readFile(join(gitDir(repositoryPath), "HEAD"), "utf8")).trim();
  const match = /^ref:\s*(refs\/heads\/.+)$/i.exec(raw);
  if (match === null) {
    fail("INVALID_CONFIG", "pushHttps requires HEAD to point at a branch.");
  }
  return { name: match[1].trim(), oid: await resolveRef(repositoryPath, match[1].trim()) };
}

function oldOidFor(refs: RemoteRef[], name: string): string {
  const match = refs.find((ref) => ref.name === name);
  return match?.oid ?? ZERO_OID;
}

function requireUnpackOk(buffer: Buffer): void {
  const lines = readPktLines(buffer).filter((line): line is Buffer => line !== null);
  const texts = lines.map((line) => lineText(line));
  if (!texts.includes("unpack ok")) {
    const error = texts.find((text) => text.startsWith("unpack ")) ?? texts[0] ?? "empty result";
    fail("REPOSITORY_UNAVAILABLE", `Smart HTTP push unpack failed: ${error}`);
  }
}

export async function pushHttps(
  repositoryPath: string,
  repositoryUrl: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<void> {
  if (!isGitRepository(repositoryPath)) {
    fail("REPOSITORY_UNAVAILABLE", `Push source ${repositoryPath} is not a git repository.`);
  }
  const url = normalizeHttpUrl(repositoryUrl);
  const advertisement = await fetchImpl(`${url}/info/refs?service=${SERVICE}`, {
    method: "GET",
    headers: {
      accept: `application/x-${SERVICE}-advertisement`,
    },
  });
  if (advertisement.status === 401) {
    fail("AUTH", "pushHttps requires authentication.");
  }
  if (advertisement.status !== 200) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP push did not return a receive-pack advertisement.");
  }
  const advertisementType = advertisement.headers.get("content-type") ?? "";
  if (!advertisementType.toLowerCase().startsWith(`application/x-${SERVICE}-advertisement`)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP push is not a receive-pack advertisement.");
  }
  const refs = parseAdvertisement(Buffer.from(await advertisement.arrayBuffer()));
  const head = await currentHead(repositoryPath);
  const packPath = join(tmpdir(), `grits-push-${randomBytes(8).toString("hex")}.pack`);
  await writePack(repositoryPath, [head.oid], packPath);
  let pack: Buffer;
  try {
    pack = await readFile(packPath);
  } finally {
    if (existsSync(packPath)) {
      await unlink(packPath);
    }
  }
  const command = encodePkt(
    `${oldOidFor(refs, head.name)} ${head.oid} ${head.name}\0report-status\n`,
  );
  const body = Buffer.concat([command, Buffer.from("0000", "ascii"), pack]);
  const response = await fetchImpl(`${url}/${SERVICE}`, {
    method: "POST",
    headers: {
      "content-type": `application/x-${SERVICE}-request`,
      accept: `application/x-${SERVICE}-result`,
    },
    body: new Uint8Array(body),
  });
  if (response.status === 401) {
    fail("AUTH", "pushHttps requires authentication.");
  }
  if (response.status !== 200) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP push did not return a receive-pack result.");
  }
  const resultType = response.headers.get("content-type") ?? "";
  if (!resultType.toLowerCase().startsWith(`application/x-${SERVICE}-result`)) {
    fail("REPOSITORY_UNAVAILABLE", "Smart HTTP push is not a receive-pack result.");
  }
  requireUnpackOk(Buffer.from(await response.arrayBuffer()));
}

