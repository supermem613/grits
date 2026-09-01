import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { deflateSync } from "node:zlib";
import { GritsError } from "../api/errors.js";
import {
  parseCommit,
  parseTree,
  readLooseObject,
  type GitObject,
} from "./git-object.js";

const OBJ_COMMIT = 1;
const OBJ_TREE = 2;
const OBJ_BLOB = 3;
const OBJ_TAG = 4;

function fail(code: GritsError["code"], message: string): never {
  throw new GritsError(code, message, "writePack");
}

function packedType(type: string): number {
  if (type === "commit") {
    return OBJ_COMMIT;
  }
  if (type === "tree") {
    return OBJ_TREE;
  }
  if (type === "blob") {
    return OBJ_BLOB;
  }
  if (type === "tag") {
    return OBJ_TAG;
  }
  fail("UNSUPPORTED_CAPABILITY", `Pack writer does not write ${type} objects.`);
}

function encodeTypeSize(type: number, size: number): Buffer {
  const bytes: number[] = [];
  let remaining = size;
  let byte = (type << 4) | (remaining & 15);
  remaining >>= 4;
  while (remaining > 0) {
    bytes.push(byte | 0x80);
    byte = remaining & 0x7f;
    remaining >>= 7;
  }
  bytes.push(byte);
  return Buffer.from(bytes);
}

function tagTarget(payload: Buffer): string | undefined {
  const first = payload.toString("utf8").split("\n", 1)[0] ?? "";
  if (!first.startsWith("object ")) {
    return undefined;
  }
  const oid = first.slice("object ".length).trim();
  if (!/^[0-9a-f]{40}$/i.test(oid)) {
    return undefined;
  }
  return oid.toLowerCase();
}

async function collectReachable(
  repositoryPath: string,
  tips: readonly string[],
): Promise<Map<string, GitObject>> {
  const objects = new Map<string, GitObject>();
  const pending = [...tips.map((id) => id.toLowerCase())];
  while (pending.length > 0) {
    const id = pending.pop();
    if (id === undefined || objects.has(id)) {
      continue;
    }
    let object: GitObject;
    try {
      object = await readLooseObject(repositoryPath, id);
    } catch {
      fail("NOT_FOUND", `Pack writer did not find object ${id}.`);
    }
    objects.set(id, object);
    if (object.type === "commit") {
      const commit = parseCommit(object.payload);
      pending.push(commit.tree, ...commit.parents);
    } else if (object.type === "tree") {
      for (const entry of parseTree(object.payload)) {
        pending.push(entry.id);
      }
    } else if (object.type === "tag") {
      const target = tagTarget(object.payload);
      if (target !== undefined) {
        pending.push(target);
      }
    }
  }
  return objects;
}

export async function writePack(
  repositoryPath: string,
  tips: readonly string[],
  packPath: string,
): Promise<void> {
  if (!packPath.endsWith(".pack")) {
    fail("INVALID_CONFIG", "Pack writer requires a .pack file.");
  }
  if (tips.length === 0) {
    fail("INVALID_CONFIG", "Pack writer requires at least one tip object.");
  }
  if (existsSync(packPath)) {
    fail("REPOSITORY_UNAVAILABLE", `Pack writer refuses to overwrite ${packPath}.`);
  }
  const objects = await collectReachable(repositoryPath, tips);
  const entries = [...objects.values()];
  const header = Buffer.alloc(12);
  header.write("PACK", 0, "ascii");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const chunks: Buffer[] = [header];
  for (const object of entries) {
    chunks.push(encodeTypeSize(packedType(object.type), object.payload.length));
    chunks.push(deflateSync(object.payload));
  }
  const body = Buffer.concat(chunks);
  const pack = Buffer.concat([
    body,
    createHash("sha1").update(body).digest(),
  ]);
  await mkdir(dirname(packPath), { recursive: true });
  await writeFile(packPath, pack, { flag: "wx" });
}

