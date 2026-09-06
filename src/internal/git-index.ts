import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitDir } from "./resolve-head.js";

export type IndexEntry = {
  mode: number;
  size: number;
  id: string;
  name: string;
  stage: number;
};

export async function readIndex(repositoryPath: string): Promise<IndexEntry[]> {
  const buf = await readFile(join(gitDir(repositoryPath), "index"));
  if (buf.subarray(0, 4).toString("ascii") !== "DIRC") {
    throw new Error("Invalid git index header");
  }
  const version = buf.readUInt32BE(4);
  if (version < 2 || version > 4) {
    throw new Error("Unsupported git index version");
  }
  const count = buf.readUInt32BE(8);
  let offset = 12;
  let previousPath = "";
  const entries: IndexEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const mode = buf.readUInt32BE(offset + 24);
    const size = buf.readUInt32BE(offset + 36);
    const id = buf.subarray(offset + 40, offset + 60).toString("hex");
    const flags = buf.readUInt16BE(offset + 60);
    const nameLength = flags & 0xfff;
    const stage = (flags >> 12) & 3;
    let nameOffset = offset + 62;
    if (version >= 3 && (flags & 0x4000) !== 0) {
      nameOffset += 2;
    }
    let name: string;
    if (version >= 4) {
      const decoded = decodeVarint(buf, nameOffset);
      if (decoded.value > previousPath.length) {
        throw new Error("Invalid git index v4 name prefix");
      }
      const nul = buf.indexOf(0, decoded.offset);
      if (nul < 0) {
        throw new Error("Invalid git index v4 name");
      }
      name = previousPath.slice(0, previousPath.length - decoded.value) +
        buf.subarray(decoded.offset, nul).toString("utf8");
      previousPath = name;
      offset = nul + 1;
    } else {
      let nameEnd = nameOffset + nameLength;
      if (nameLength === 0xfff) {
        const nul = buf.indexOf(0, nameOffset);
        if (nul < 0) {
          throw new Error("Invalid git index long name");
        }
        nameEnd = nul;
      }
      name = buf.subarray(nameOffset, nameEnd).toString("utf8");
      const entryLength = nameEnd - offset + 1;
      const padding = (8 - (entryLength % 8)) % 8;
      offset += entryLength + padding;
    }
    entries.push({ mode, size, id, name, stage });
  }
  return entries;
}

function decodeVarint(buf: Buffer, offset: number) {
  if (offset >= buf.length) {
    throw new Error("Invalid git index v4 name varint");
  }
  let current = buf[offset]!;
  offset += 1;
  let value = current & 127;
  while ((current & 128) !== 0) {
    value += 1;
    if (value === 0 || value > Number.MAX_SAFE_INTEGER >> 7) {
      throw new Error("Invalid git index v4 name varint");
    }
    if (offset >= buf.length) {
      throw new Error("Invalid git index v4 name varint");
    }
    current = buf[offset]!;
    offset += 1;
    value = (value << 7) + (current & 127);
  }
  return { value, offset };
}

export async function writeIndex(
  repositoryPath: string,
  entries: readonly IndexEntry[],
): Promise<void> {
  await writeIndexFile(join(gitDir(repositoryPath), "index"), entries);
}

export async function writeIndexFile(
  indexPath: string,
  entries: readonly IndexEntry[],
): Promise<void> {
  const sorted = [...entries].sort((left, right) => {
    if (left.name < right.name) {
      return -1;
    }
    if (left.name > right.name) {
      return 1;
    }
    return (left.stage ?? 0) - (right.stage ?? 0);
  });
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write("DIRC");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(sorted.length, 8);
  parts.push(header);
  for (const entry of sorted) {
    const name = Buffer.from(entry.name, "utf8");
    const entryLength = 63 + name.length;
    const padding = (8 - (entryLength % 8)) % 8;
    const buf = Buffer.alloc(entryLength + padding);
    buf.writeUInt32BE(entry.mode, 24);
    buf.writeUInt32BE(entry.size, 36);
    Buffer.from(entry.id, "hex").copy(buf, 40);
    const stage = entry.stage ?? 0;
    buf.writeUInt16BE(((stage & 3) << 12) | Math.min(name.length, 0xfff), 60);
    name.copy(buf, 62);
    parts.push(buf);
  }
  const body = Buffer.concat(parts);
  const digest = createHash("sha1").update(body).digest();
  await writeFile(indexPath, Buffer.concat([body, digest]));
}
