import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createInflate, inflateSync } from "node:zlib";
import { GritsError } from "../api/errors.js";
import type { GitObject } from "./git-object.js";
import { gitDir } from "./resolve-head.js";

const IDX_V2_MAGIC = Buffer.from([0xff, 0x74, 0x4f, 0x63]);
const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;
const OBJ_OFS_DELTA = 6;
const OBJ_REF_DELTA = 7;
const TYPE_NAME: Record<number, GitObject["type"]> = {
  [OBJ_COMMIT]: "commit",
  [OBJ_TREE]: "tree",
  [OBJ_BLOB]: "blob",
  [OBJ_TAG]: "tag",
};

type PackIndex = {
  idxPath: string;
  packPath: string;
  names: Buffer;
  offsets: number[];
  sortedOffsets: number[];
  count: number;
};

function nyI(message: string): GritsError {
  return new GritsError("NYI", message, "objects.read");
}

function readUInt32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}

async function inflatePacked(pack: Buffer, start: number, end: number): Promise<Buffer> {
  try {
    return inflateSync(pack.subarray(start, end));
  } catch {
    return inflateStream(pack.subarray(start));
  }
}

function inflateStream(input: Buffer): Promise<Buffer> {
  const inflator = createInflate();
  const chunks: Buffer[] = [];
  return new Promise((resolve, reject) => {
    inflator.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    inflator.on("error", reject);
    inflator.on("end", () => resolve(Buffer.concat(chunks)));
    inflator.end(input);
  });
}

function decodeSize(pack: Buffer, offset: number): { type: number; size: number; pos: number } {
  let pos = offset;
  let byte = pack[pos];
  pos += 1;
  const type = (byte >> 4) & 7;
  let size = byte & 15;
  let shift = 4;
  while ((byte & 0x80) !== 0) {
    byte = pack[pos];
    pos += 1;
    size |= (byte & 0x7f) << shift;
    shift += 7;
  }
  return { type, size, pos };
}

function decodeOfsDelta(pack: Buffer, pos: number): { baseDistance: number; pos: number } {
  let byte = pack[pos];
  pos += 1;
  let baseDistance = byte & 0x7f;
  while ((byte & 0x80) !== 0) {
    byte = pack[pos];
    pos += 1;
    baseDistance += 1;
    baseDistance <<= 7;
    baseDistance |= byte & 0x7f;
  }
  return { baseDistance, pos };
}

function decodeVarInt(delta: Buffer, pos: number): { value: number; pos: number } {
  let byte = delta[pos];
  pos += 1;
  let value = byte & 0x7f;
  let shift = 7;
  while ((byte & 0x80) !== 0) {
    byte = delta[pos];
    pos += 1;
    value |= (byte & 0x7f) << shift;
    shift += 7;
  }
  return { value, pos };
}

function applyDelta(base: Buffer, delta: Buffer): Buffer {
  let pos = 0;
  const source = decodeVarInt(delta, pos);
  pos = source.pos;
  if (source.value !== base.length) {
    throw new Error(`Packed delta source size ${source.value} does not match base ${base.length}.`);
  }
  const target = decodeVarInt(delta, pos);
  pos = target.pos;
  const out = Buffer.alloc(target.value);
  let outPos = 0;
  while (pos < delta.length) {
    const cmd = delta[pos];
    pos += 1;
    if ((cmd & 0x80) !== 0) {
      let copyOff = 0;
      let copySize = 0;
      if ((cmd & 0x01) !== 0) {
        copyOff = delta[pos];
        pos += 1;
      }
      if ((cmd & 0x02) !== 0) {
        copyOff |= delta[pos] << 8;
        pos += 1;
      }
      if ((cmd & 0x04) !== 0) {
        copyOff |= delta[pos] << 16;
        pos += 1;
      }
      if ((cmd & 0x08) !== 0) {
        copyOff |= delta[pos] << 24;
        pos += 1;
      }
      if ((cmd & 0x10) !== 0) {
        copySize = delta[pos];
        pos += 1;
      }
      if ((cmd & 0x20) !== 0) {
        copySize |= delta[pos] << 8;
        pos += 1;
      }
      if ((cmd & 0x40) !== 0) {
        copySize |= delta[pos] << 16;
        pos += 1;
      }
      if (copySize === 0) {
        copySize = 0x10000;
      }
      if (copyOff + copySize > base.length || outPos + copySize > out.length) {
        throw new Error("Packed delta copy is out of range.");
      }
      base.copy(out, outPos, copyOff, copyOff + copySize);
      outPos += copySize;
    } else if (cmd !== 0) {
      if (pos + cmd > delta.length || outPos + cmd > out.length) {
        throw new Error("Packed delta insert is out of range.");
      }
      delta.copy(out, outPos, pos, pos + cmd);
      outPos += cmd;
      pos += cmd;
    } else {
      throw new Error("Packed delta command 0 is reserved.");
    }
  }
  if (outPos !== out.length) {
    throw new Error(`Packed delta output length ${outPos} does not match ${out.length}.`);
  }
  return out;
}

function compareName(names: Buffer, index: number, want: Buffer): number {
  for (let i = 0; i < 20; i += 1) {
    const delta = names[index * 20 + i] - want[i];
    if (delta !== 0) {
      return delta;
    }
  }
  return 0;
}

function lookupOffset(index: PackIndex, id: string): number | null {
  const want = Buffer.from(id, "hex");
  let lo = 0;
  let hi = index.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const cmp = compareName(index.names, mid, want);
    if (cmp === 0) {
      return index.offsets[mid];
    }
    if (cmp < 0) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return null;
}

function nextOffset(index: PackIndex, offset: number, packLength: number): number {
  for (const candidate of index.sortedOffsets) {
    if (candidate > offset) {
      return candidate;
    }
  }
  return packLength - 20;
}

async function parseIndex(idxPath: string): Promise<PackIndex> {
  const buf = await readFile(idxPath);
  if (buf.length < 8 || !buf.subarray(0, 4).equals(IDX_V2_MAGIC)) {
    throw nyI("NYI: pack index version 1 is not read.");
  }
  const version = readUInt32(buf, 4);
  if (version !== 2) {
    throw nyI(`NYI: pack index version ${version} is not read.`);
  }
  const count = readUInt32(buf, 8 + 255 * 4);
  const namesOff = 8 + 256 * 4;
  const crcOff = namesOff + count * 20;
  const off32 = crcOff + count * 4;
  const names = buf.subarray(namesOff, namesOff + count * 20);
  const offsets: number[] = [];
  for (let i = 0; i < count; i += 1) {
    offsets.push(readUInt32(buf, off32 + i * 4));
  }
  const largeOff = off32 + count * 4;
  for (let i = 0; i < count; i += 1) {
    const raw = offsets[i];
    if ((raw & 0x80000000) === 0) {
      continue;
    }
    const index64 = raw & 0x7fffffff;
    const value = buf.readBigUInt64BE(largeOff + index64 * 8);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw nyI("NYI: pack offsets above Number.MAX_SAFE_INTEGER are not read.");
    }
    offsets[i] = Number(value);
  }
  return {
    idxPath,
    packPath: idxPath.slice(0, -4) + ".pack",
    names,
    offsets,
    sortedOffsets: [...offsets].sort((a, b) => a - b),
    count,
  };
}

async function listIndexes(repositoryPath: string): Promise<string[]> {
  const packDir = join(gitDir(repositoryPath), "objects", "pack");
  if (!existsSync(packDir)) {
    return [];
  }
  const names = await readdir(packDir);
  return names.filter((name) => name.endsWith(".idx")).map((name) => join(packDir, name));
}

async function readLooseOnly(repositoryPath: string, id: string): Promise<GitObject | null> {
  const objectPath = join(gitDir(repositoryPath), "objects", id.slice(0, 2), id.slice(2));
  try {
    const inflated = inflateSync(await readFile(objectPath));
    const separator = inflated.indexOf(0);
    const header = separator === -1 ? "" : inflated.subarray(0, separator).toString("ascii");
    const match = /^(commit|tree|blob|tag) (\d+)$/.exec(header);
    if (separator === -1 || match === null) {
      throw new Error(`Invalid object header for ${id}`);
    }
    return {
      type: match[1] as GitObject["type"],
      payload: Buffer.from(inflated.subarray(separator + 1)),
    };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function readAtOffset(
  repositoryPath: string,
  index: PackIndex,
  pack: Buffer,
  offset: number,
  seen: Set<string>,
): Promise<GitObject> {
  const key = `${index.packPath}:${offset}`;
  if (seen.has(key)) {
    throw new Error(`Packed delta cycle at ${key}.`);
  }
  seen.add(key);
  if (pack.subarray(0, 4).toString("ascii") !== "PACK") {
    throw new Error(`Invalid pack header in ${index.packPath}.`);
  }
  const version = readUInt32(pack, 4);
  if (version !== 2) {
    throw nyI(`NYI: pack version ${version} is not read.`);
  }
  const header = decodeSize(pack, offset);
  let pos = header.pos;
  if (header.type === OBJ_OFS_DELTA) {
    const ofs = decodeOfsDelta(pack, pos);
    pos = ofs.pos;
    const delta = await inflatePacked(pack, pos, nextOffset(index, offset, pack.length));
    const base = await readAtOffset(repositoryPath, index, pack, offset - ofs.baseDistance, seen);
    return { type: base.type, payload: applyDelta(base.payload, delta) };
  }
  if (header.type === OBJ_REF_DELTA) {
    const baseId = pack.subarray(pos, pos + 20).toString("hex");
    pos += 20;
    const delta = await inflatePacked(pack, pos, nextOffset(index, offset, pack.length));
    const base = await resolveObject(repositoryPath, baseId, seen);
    if (base === null) {
      throw nyI(`NYI: packed delta base ${baseId} is not present as a loose or packed object.`);
    }
    return { type: base.type, payload: applyDelta(base.payload, delta) };
  }
  const type = TYPE_NAME[header.type];
  if (type === undefined) {
    throw new Error(`Unknown packed object type ${header.type}.`);
  }
  const payload = await inflatePacked(pack, pos, nextOffset(index, offset, pack.length));
  if (payload.length !== header.size) {
    throw new Error(`Packed ${type} size ${payload.length} does not match header ${header.size}.`);
  }
  return { type, payload };
}

async function resolveObject(
  repositoryPath: string,
  id: string,
  seen: Set<string>,
): Promise<GitObject | null> {
  const loose = await readLooseOnly(repositoryPath, id);
  if (loose !== null) {
    return loose;
  }
  return readPackedObject(repositoryPath, id, seen);
}

export async function readPackedObject(
  repositoryPath: string,
  id: string,
  seen: Set<string> = new Set(),
): Promise<GitObject | null> {
  const normalized = id.toLowerCase();
  if (seen.has(normalized)) {
    throw new Error(`Packed delta cycle at ${normalized}.`);
  }
  seen.add(normalized);
  for (const idxPath of await listIndexes(repositoryPath)) {
    const index = await parseIndex(idxPath);
    const offset = lookupOffset(index, normalized);
    if (offset === null) {
      continue;
    }
    if (!existsSync(index.packPath)) {
      continue;
    }
    const pack = await readFile(index.packPath);
    return readAtOffset(repositoryPath, index, pack, offset, new Set(seen));
  }
  return null;
}
