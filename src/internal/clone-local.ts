import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { gitDir } from "./resolve-head.js";

export function isRemoteGitUrl(value: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|git:\/\/)/i.test(value);
}

export async function copyGitDir(sourceRepo: string, destRepo: string): Promise<void> {
  const sourceGit = gitDir(sourceRepo);
  const destGit = gitDir(destRepo);
  await mkdir(destGit, { recursive: true });
  await copyTree(join(sourceGit, "objects"), join(destGit, "objects"));
  await copyTree(join(sourceGit, "refs"), join(destGit, "refs"));
  await copyIfExists(join(sourceGit, "packed-refs"), join(destGit, "packed-refs"));
  await copyIfExists(join(sourceGit, "HEAD"), join(destGit, "HEAD"));
  const config = `[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n`;
  await writeFile(join(destGit, "config"), config, "utf8");
}

async function copyIfExists(from: string, to: string): Promise<void> {
  if (!existsSync(from)) {
    return;
  }
  await copyFile(from, to);
}

async function copyTree(from: string, to: string): Promise<void> {
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
    } else {
      await copyFile(src, dest);
    }
  }
}

export function requireLocalCloneSource(slotId: string, source: string): void {
  if (isRemoteGitUrl(source)) {
    throw new GritsError("NYI", `NYI: ${slotId} does not clone remote URLs.`, slotId);
  }
  if (!existsSync(source) || !existsSync(join(source, ".git"))) {
    throw new GritsError("NOT_FOUND", `Clone source ${source} is not a git repository.`, slotId);
  }
}
