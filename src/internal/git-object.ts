import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import { gitDir, resolveHead } from "./resolve-head.js";

export type GitObject = {
  type: string;
  payload: Buffer;
};

export type Ident = {
  name: string;
  email: string;
  timestamp: string;
  tz: string;
};

export type ParsedCommit = {
  tree: string;
  parents: string[];
  author: Ident;
  committer: Ident;
  message: string;
};

export type TreeEntry = {
  mode: string;
  name: string;
  id: string;
};

export function hashObject(type: string, payload: Uint8Array): string {
  const header = Buffer.from(`${type} ${payload.byteLength}\0`, "utf8");
  return createHash("sha1").update(header).update(payload).digest("hex");
}

export async function writeLooseObject(
  repositoryPath: string,
  type: string,
  payload: Uint8Array,
): Promise<string> {
  const id = hashObject(type, payload);
  const shard = id.slice(0, 2);
  const objectPath = join(gitDir(repositoryPath), "objects", shard, id.slice(2));
  const object = Buffer.concat([
    Buffer.from(`${type} ${payload.byteLength}\0`, "utf8"),
    Buffer.from(payload),
  ]);
  await mkdir(join(gitDir(repositoryPath), "objects", shard), { recursive: true });
  try {
    await writeFile(objectPath, deflateSync(object), { flag: "wx" });
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
      throw error;
    }
  }
  return id;
}

export function serializeTree(entries: readonly TreeEntry[]): Buffer {
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
  for (const entry of sorted) {
    parts.push(
      Buffer.concat([
        Buffer.from(`${entry.mode} ${entry.name}\0`, "utf8"),
        Buffer.from(entry.id, "hex"),
      ]),
    );
  }
  return Buffer.concat(parts);
}

export async function writeTreeFromEntries(
  repositoryPath: string,
  entries: readonly TreeEntry[],
): Promise<string> {
  return writeLooseObject(repositoryPath, "tree", serializeTree(entries));
}

export async function readLooseObject(
  repositoryPath: string,
  id: string,
): Promise<GitObject> {
  const normalized = id.toLowerCase();
  const objectPath = join(
    gitDir(repositoryPath),
    "objects",
    normalized.slice(0, 2),
    normalized.slice(2),
  );
  const inflated = inflateSync(await readFile(objectPath));
  const separator = inflated.indexOf(0);
  const header =
    separator === -1 ? "" : inflated.subarray(0, separator).toString("ascii");
  const match = /^(commit|tree|blob|tag) (\d+)$/.exec(header);
  if (separator === -1 || match === null) {
    throw new Error(`Invalid object header for ${id}`);
  }
  return {
    type: match[1],
    payload: Buffer.from(inflated.subarray(separator + 1)),
  };
}

export function parseIdent(raw: string): Ident {
  const match = /^(.*) <([^>]+)> (\d+) ([+-]\d{4})$/.exec(raw);
  if (match === null) {
    throw new Error(`Invalid ident: ${raw}`);
  }
  return {
    name: match[1],
    email: match[2],
    timestamp: match[3],
    tz: match[4],
  };
}

export function parseCommit(payload: Buffer): ParsedCommit {
  const text = payload.toString("utf8");
  const split = text.indexOf("\n\n");
  const header = split === -1 ? text : text.slice(0, split);
  const message = split === -1 ? "" : text.slice(split + 2);
  const parents: string[] = [];
  let tree = "";
  let author: Ident | undefined;
  let committer: Ident | undefined;
  for (const line of header.split("\n")) {
    if (line.startsWith("tree ")) {
      tree = line.slice(5);
    } else if (line.startsWith("parent ")) {
      parents.push(line.slice(7));
    } else if (line.startsWith("author ")) {
      author = parseIdent(line.slice(7));
    } else if (line.startsWith("committer ")) {
      committer = parseIdent(line.slice(10));
    }
  }
  if (tree.length === 0 || author === undefined || committer === undefined) {
    throw new Error("Invalid commit");
  }
  return { tree, parents, author, committer, message };
}

export function parseTree(payload: Buffer): TreeEntry[] {
  const entries: TreeEntry[] = [];
  let offset = 0;
  while (offset < payload.length) {
    const space = payload.indexOf(0x20, offset);
    const nul = payload.indexOf(0, space + 1);
    const mode = payload.subarray(offset, space).toString("ascii");
    const name = payload.subarray(space + 1, nul).toString("utf8");
    const id = payload.subarray(nul + 1, nul + 21).toString("hex");
    entries.push({ mode, name, id });
    offset = nul + 21;
  }
  return entries;
}

export async function readCommit(
  repositoryPath: string,
  id: string,
): Promise<ParsedCommit> {
  const object = await readLooseObject(repositoryPath, id);
  if (object.type !== "commit") {
    throw new Error(`Expected commit, got ${object.type}`);
  }
  return parseCommit(object.payload);
}

export async function readTreeEntries(
  repositoryPath: string,
  treeId: string,
): Promise<TreeEntry[]> {
  const object = await readLooseObject(repositoryPath, treeId);
  if (object.type !== "tree") {
    throw new Error(`Expected tree, got ${object.type}`);
  }
  return parseTree(object.payload);
}

export async function headTreeId(repositoryPath: string): Promise<string> {
  const head = await resolveHead(repositoryPath);
  return (await readCommit(repositoryPath, head)).tree;
}

export async function firstParentId(repositoryPath: string): Promise<string> {
  const head = await resolveHead(repositoryPath);
  const commit = await readCommit(repositoryPath, head);
  if (commit.parents.length === 0) {
    throw new Error("HEAD has no parent");
  }
  return commit.parents[0];
}
