import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { gitDir } from "./resolve-head.js";

export type IndexEntry = {
  mode: number;
  size: number;
  id: string;
  name: string;
};

export async function readIndex(repositoryPath: string): Promise<IndexEntry[]> {
  const buf = await readFile(join(gitDir(repositoryPath), "index"));
  if (buf.subarray(0, 4).toString("ascii") !== "DIRC") {
    throw new Error("Invalid git index header");
  }
  const count = buf.readUInt32BE(8);
  let offset = 12;
  const entries: IndexEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const mode = buf.readUInt32BE(offset + 24);
    const size = buf.readUInt32BE(offset + 36);
    const id = buf.subarray(offset + 40, offset + 60).toString("hex");
    const flags = buf.readUInt16BE(offset + 60);
    const nameLength = flags & 0xfff;
    const name = buf.subarray(offset + 62, offset + 62 + nameLength).toString("utf8");
    const entryLength = 62 + nameLength;
    const padding = (8 - (entryLength % 8)) % 8;
    offset += entryLength + padding;
    entries.push({ mode, size, id, name });
  }
  return entries;
}

export async function writeIndex(
  repositoryPath: string,
  entries: readonly IndexEntry[],
): Promise<void> {
  const sorted = [...entries].sort((left, right) => {
    if (left.name < right.name) {
      return -1;
    }
    if (left.name > right.name) {
      return 1;
    }
    return 0;
  });
  const parts: Buffer[] = [];
  const header = Buffer.alloc(12);
  header.write("DIRC");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(sorted.length, 8);
  parts.push(header);
  for (const entry of sorted) {
    const name = Buffer.from(entry.name, "utf8");
    const entryLength = 62 + name.length;
    const padding = (8 - (entryLength % 8)) % 8;
    const buf = Buffer.alloc(entryLength + padding);
    buf.writeUInt32BE(entry.mode, 24);
    buf.writeUInt32BE(entry.size, 36);
    Buffer.from(entry.id, "hex").copy(buf, 40);
    buf.writeUInt16BE(Math.min(name.length, 0xfff), 60);
    name.copy(buf, 62);
    parts.push(buf);
  }
  const body = Buffer.concat(parts);
  const digest = createHash("sha1").update(body).digest();
  await writeFile(join(gitDir(repositoryPath), "index"), Buffer.concat([body, digest]));
}
