import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GritsError } from "../api/errors.js";

const OID = /^[0-9a-f]{40}$/i;

export function gitDir(repositoryPath: string): string {
  const nested = join(repositoryPath, ".git");
  if (existsSync(nested)) {
    if (statSync(nested).isFile()) {
      const contents = readFileSync(nested, "utf8");
      const line = contents.split(/\r?\n/).find((value) => /^gitdir:/i.test(value));
      const match = line === undefined ? null : /^gitdir:\s*(.+)$/i.exec(line);
      if (match !== null) {
        return resolve(repositoryPath, match[1].trim());
      }
    }
    return nested;
  }
  if (existsSync(join(repositoryPath, "HEAD")) && existsSync(join(repositoryPath, "objects"))) {
    return repositoryPath;
  }
  return nested;
}

function refsGitDir(repositoryPath: string): string {
  const localGitDir = gitDir(repositoryPath);
  const commondirPath = join(localGitDir, "commondir");
  if (!existsSync(commondirPath)) {
    return localGitDir;
  }

  const commondir = readFileSync(commondirPath, "utf8").trim();
  return commondir.length === 0 ? localGitDir : resolve(localGitDir, commondir);
}

export async function resolveHead(repositoryPath: string): Promise<string> {
  const headPath = join(gitDir(repositoryPath), "HEAD");
  let raw: string;
  try {
    raw = await readFile(headPath, "utf8");
  } catch {
    throw new GritsError(
      "REPOSITORY_UNAVAILABLE",
      "HEAD is not readable.",
      "refs.resolve",
    );
  }

  const text = raw.trim();
  if (OID.test(text)) {
    return text.toLowerCase();
  }

  const match = /^ref:\s*(.+)$/i.exec(text);
  if (match === null) {
    throw new GritsError(
      "NOT_FOUND",
      "HEAD does not contain a ref or object id.",
      "refs.resolve",
    );
  }

  return resolveRef(repositoryPath, match[1].trim());
}

export async function resolveRef(
  repositoryPath: string,
  refName: string,
): Promise<string> {
  const loosePath = join(refsGitDir(repositoryPath), ...refName.split("/"));
  try {
    const value = (await readFile(loosePath, "utf8")).trim();
    if (OID.test(value)) {
      return value.toLowerCase();
    }
    if (value.toLowerCase().startsWith("ref:")) {
      return resolveRef(repositoryPath, value.slice(4).trim());
    }
  } catch {
    // Fall through to packed-refs.
  }

  const packed = await readPackedRef(repositoryPath, refName);
  if (packed !== null) {
    return packed;
  }

  throw new GritsError(
    "NOT_FOUND",
    `Ref ${refName} was not found.`,
    "refs.resolve",
  );
}

async function readPackedRef(
  repositoryPath: string,
  refName: string,
): Promise<string | null> {
  let packed: string;
  try {
    packed = await readFile(join(refsGitDir(repositoryPath), "packed-refs"), "utf8");
  } catch {
    return null;
  }

  for (const line of packed.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith("#") || line.startsWith("^")) {
      continue;
    }
    const space = line.indexOf(" ");
    if (space === -1) {
      continue;
    }
    const id = line.slice(0, space);
    const name = line.slice(space + 1);
    if (name === refName && OID.test(id)) {
      return id.toLowerCase();
    }
  }

  return null;
}
