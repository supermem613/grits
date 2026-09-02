import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { GritsError } from "../api/errors.js";
import { gitDir, resolveRef } from "./resolve-head.js";

export function isRemoteGitUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/|file:\/\/)/i.test(value);
}

export function toLocalGitPath(value: string): string {
  if (!/^file:/i.test(value)) {
    return value;
  }
  return fileURLToPath(value);
}

export { cloneHttps } from "./smart-http-fetch.js";

export async function copyGitDir(sourceRepo: string, destRepo: string): Promise<void> {
  const sourceGit = gitDir(sourceRepo);
  const destGit = gitDir(destRepo);
  await mkdir(destGit, { recursive: true });
  await copyTree(join(sourceGit, "objects"), join(destGit, "objects"));
  await copyTree(join(sourceGit, "refs"), join(destGit, "refs"));
  await copyIfExists(join(sourceGit, "packed-refs"), join(destGit, "packed-refs"));
  await copyIfExists(join(sourceGit, "HEAD"), join(destGit, "HEAD"));
  await writeOriginRemote(sourceRepo, destRepo);
}

export async function writeOriginRemote(sourceRepo: string, destRepo: string): Promise<void> {
  const destGit = gitDir(destRepo);
  const origin = sourceRepo.replaceAll("\\", "/");
  let branch = "master";
  try {
    const head = (await readFile(join(destGit, "HEAD"), "utf8")).trim();
    const match = /^ref:\s*refs\/heads\/(.+)$/i.exec(head);
    if (match !== null) {
      branch = match[1];
      const oid = await resolveRef(destRepo, `refs/heads/${branch}`);
      await mkdir(join(destGit, "refs", "remotes", "origin"), { recursive: true });
      await writeFile(join(destGit, "refs", "remotes", "origin", branch), `${oid}\n`, "utf8");
    }
  } catch {
    // Detached HEAD still gets origin url and fetch spec.
  }
  await writeFile(
    join(destGit, "config"),
    `[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n[remote "origin"]\n\turl = ${origin}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[branch "${branch}"]\n\tremote = origin\n\tmerge = refs/heads/${branch}\n`,
    "utf8",
  );
}

async function copyIfExists(from: string, to: string): Promise<void> {
  if (!existsSync(from)) {
    return;
  }
  await copyFile(from, to);
}

export async function copyTree(from: string, to: string): Promise<void> {
  if (!existsSync(from)) {
    return;
  }
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) {
      await copyTree(src, dest);
    } else if (!existsSync(dest)) {
      await copyFile(src, dest);
    }
  }
}

export function isGitRepository(path: string): boolean {
  return existsSync(join(path, ".git")) || (existsSync(join(path, "HEAD")) && existsSync(join(path, "objects")));
}

export function requireLocalCloneSource(slotId: string, source: string): string {
  const localPath = toLocalGitPath(source);
  if (isRemoteGitUrl(localPath)) {
    throw new GritsError("NYI", `NYI: ${slotId} does not clone remote URLs.`, slotId);
  }
  if (!existsSync(localPath) || !isGitRepository(localPath)) {
    throw new GritsError("NOT_FOUND", `Clone source ${localPath} is not a git repository.`, slotId);
  }
  return localPath;
}
