import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GritsError } from "../api/errors.js";
import { gitDir, resolveHead, resolveRef } from "./resolve-head.js";

const OID = /^[0-9a-f]{40}$/i;

export async function resolveRevision(
  repositoryPath: string,
  rev: string,
): Promise<string> {
  if (rev.length === 0 || rev === "HEAD") {
    return resolveHead(repositoryPath);
  }
  if (OID.test(rev)) {
    return rev.toLowerCase();
  }
  if (rev === "HEAD^" || rev === "HEAD~1") {
    const { firstParentId } = await import("./git-object.js");
    return firstParentId(repositoryPath);
  }
  try {
    return await resolveRef(repositoryPath, rev);
  } catch {
    // Try common ref prefixes.
  }
  try {
    return await resolveRef(repositoryPath, `refs/heads/${rev}`);
  } catch {
    // Try tags.
  }
  try {
    return await resolveRef(repositoryPath, `refs/tags/${rev}`);
  } catch {
    throw new GritsError("NOT_FOUND", `Revision ${rev} was not found.`, "refs.resolve");
  }
}

export async function updateRef(
  repositoryPath: string,
  refName: string,
  objectId: string,
): Promise<void> {
  if (!OID.test(objectId)) {
    throw new GritsError("INVALID_CONFIG", `Invalid object id ${objectId}.`, "refs.update");
  }
  let target = refName;
  if (refName === "HEAD") {
    const head = (await readFile(join(gitDir(repositoryPath), "HEAD"), "utf8")).trim();
    const symbolic = /^ref:\s*(.+)$/i.exec(head);
    if (symbolic !== null) {
      target = symbolic[1].trim();
    }
  }
  const refPath = join(gitDir(repositoryPath), ...target.split("/"));
  await mkdir(dirname(refPath), { recursive: true });
  await writeFile(refPath, `${objectId.toLowerCase()}\n`, "utf8");
}

export async function updateRefNoDeref(
  repositoryPath: string,
  refName: string,
  objectId: string,
): Promise<void> {
  if (!OID.test(objectId)) {
    throw new GritsError("INVALID_CONFIG", `Invalid object id ${objectId}.`, "refs.update");
  }
  const refPath = join(gitDir(repositoryPath), ...refName.split("/"));
  await mkdir(dirname(refPath), { recursive: true });
  await writeFile(refPath, `${objectId.toLowerCase()}\n`, "utf8");
}

export async function deleteRef(repositoryPath: string, refName: string): Promise<void> {
  const refPath = join(gitDir(repositoryPath), ...refName.split("/"));
  await rm(refPath, { force: true });
}

export async function listRefNames(
  repositoryPath: string,
  prefix: string,
): Promise<string[]> {
  const names = new Set<string>();
  const root = join(gitDir(repositoryPath), ...prefix.split("/"));
  await collectLooseRefs(root, prefix, names);
  try {
    const packed = await readFile(join(gitDir(repositoryPath), "packed-refs"), "utf8");
    for (const line of packed.split(/\r?\n/)) {
      if (line.length === 0 || line.startsWith("#") || line.startsWith("^")) {
        continue;
      }
      const space = line.indexOf(" ");
      if (space === -1) {
        continue;
      }
      const name = line.slice(space + 1);
      if (name.startsWith(prefix)) {
        names.add(name);
      }
    }
  } catch {
    // No packed-refs.
  }
  return [...names].sort();
}

async function collectLooseRefs(
  directory: string,
  prefix: string,
  names: Set<string>,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(directory, entry);
    try {
      const nested = await readdir(full);
      void nested;
      await collectLooseRefs(full, `${prefix}/${entry}`, names);
    } catch {
      names.add(`${prefix}/${entry}`.replace(/^\//, ""));
    }
  }
}

export async function readSymbolicHead(repositoryPath: string): Promise<string | null> {
  const text = (await readFile(join(gitDir(repositoryPath), "HEAD"), "utf8")).trim();
  const match = /^ref:\s*(.+)$/i.exec(text);
  return match === null ? null : match[1].trim();
}
