import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

function hashBlob(bytes: Uint8Array): string {
  return createHash("sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex");
}

export async function writeLooseBlob(
  repositoryPath: string,
  bytes: Uint8Array,
): Promise<string> {
  const id = hashBlob(bytes).toLowerCase();
  const gitDir = join(repositoryPath, ".git");
  const shard = id.slice(0, 2);
  const objectPath = join(gitDir, "objects", shard, id.slice(2));
  const object = Buffer.concat([
    Buffer.from(`blob ${bytes.length}\0`),
    Buffer.from(bytes),
  ]);

  await mkdir(join(gitDir, "objects", shard), { recursive: true });

  try {
    await writeFile(objectPath, deflateSync(object), { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }

  return id;
}

export async function readLooseBlob(
  repositoryPath: string,
  id: string,
): Promise<Uint8Array> {
  if (!/^[0-9a-f]{40}$/i.test(id)) {
    throw new Error(`Invalid loose object id: ${id}`);
  }

  const gitDir = join(repositoryPath, ".git");
  const objectPath = join(gitDir, "objects", id.slice(0, 2), id.slice(2));
  const inflated = inflateSync(await readFile(objectPath));
  const separator = inflated.indexOf(0);
  const header =
    separator === -1 ? "" : inflated.subarray(0, separator).toString("ascii");

  if (separator === -1 || !/^blob \d+$/.test(header)) {
    throw new Error(`Invalid loose blob header for ${id}`);
  }

  return new Uint8Array(inflated.subarray(separator + 1));
}
