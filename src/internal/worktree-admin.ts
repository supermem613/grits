import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { GritsError } from "../api/errors.js";
import { flattenTree, readCommit, readLooseObject } from "./git-object.js";
import { writeIndexFile, type IndexEntry } from "./git-index.js";
import { gitDir } from "./resolve-head.js";
import { resolveRevision } from "./refs.js";

function slash(path: string): string {
  return resolve(path).replaceAll("\\", "/");
}

function adminDir(repositoryPath: string, name: string): string {
  return join(gitDir(repositoryPath), "worktrees", name);
}

export async function addWorktree(
  repositoryPath: string,
  dest: string,
  ref: string,
  checkoutFiles: boolean,
): Promise<string> {
  if (existsSync(dest) && (await readdir(dest)).length > 0) {
    throw new GritsError("INVALID_CONFIG", `Worktree dest ${dest} exists.`, "worktree.addDetach");
  }
  const oid = await resolveRevision(repositoryPath, ref);
  const name = basename(dest);
  const admin = adminDir(repositoryPath, name);
  if (existsSync(admin)) {
    throw new GritsError("INVALID_CONFIG", `Worktree ${name} already exists.`, "worktree.addDetach");
  }
  await mkdir(admin, { recursive: true });
  await mkdir(dest, { recursive: true });
  await writeFile(join(dest, ".git"), `gitdir: ${slash(admin)}\n`, "utf8");
  await writeFile(join(admin, "gitdir"), `${slash(join(dest, ".git"))}\n`, "utf8");
  await writeFile(join(admin, "commondir"), "../..\n", "utf8");
  await writeFile(join(admin, "HEAD"), `${oid}\n`, "utf8");
  if (!checkoutFiles) {
    await writeIndexFile(join(admin, "index"), []);
    return "";
  }
  const commit = await readCommit(repositoryPath, oid);
  const files = await flattenTree(repositoryPath, commit.tree);
  const entries: IndexEntry[] = [];
  for (const file of files) {
    const object = await readLooseObject(repositoryPath, file.id);
    const filePath = join(dest, file.name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, object.payload);
    entries.push({
      mode: Number.parseInt(file.mode, 8),
      size: object.payload.byteLength,
      id: file.id,
      name: file.name,
      stage: 0,
    });
  }
  await writeIndexFile(join(admin, "index"), entries);
  return "";
}

export async function removeWorktree(repositoryPath: string, dest: string): Promise<string> {
  const name = basename(dest);
  if (resolve(dest) === resolve(repositoryPath)) {
    throw new GritsError("INVALID_CONFIG", "Refusing to remove the main worktree.", "worktree.removeForce");
  }
  await rm(dest, { recursive: true, force: true });
  await rm(adminDir(repositoryPath, name), { recursive: true, force: true });
  return "";
}

export async function moveWorktree(
  repositoryPath: string,
  from: string,
  to: string,
): Promise<string> {
  const name = basename(from);
  const admin = adminDir(repositoryPath, name);
  if (!existsSync(admin)) {
    throw new GritsError("NOT_FOUND", `Worktree ${name} was not found.`, "worktree.move");
  }
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
  await writeFile(join(admin, "gitdir"), `${slash(join(to, ".git"))}\n`, "utf8");
  return "";
}

export async function pruneWorktrees(repositoryPath: string): Promise<string> {
  const root = join(gitDir(repositoryPath), "worktrees");
  if (!existsSync(root)) {
    return "";
  }
  for (const name of await readdir(root)) {
    const gitdirFile = join(root, name, "gitdir");
    let pointer = "";
    try {
      pointer = (await readFile(gitdirFile, "utf8")).trim();
    } catch {
      await rm(join(root, name), { recursive: true, force: true });
      continue;
    }
    if (!existsSync(pointer)) {
      await rm(join(root, name), { recursive: true, force: true });
    }
  }
  return "";
}

export async function sparseCheckoutInitCone(repositoryPath: string): Promise<string> {
  const dir = gitDir(repositoryPath);
  await mkdir(join(dir, "info"), { recursive: true });
  const configPath = join(dir, "config");
  const existing = existsSync(configPath) ? await readFile(configPath, "utf8") : "";
  if (!/sparseCheckout\s*=/.test(existing)) {
    await writeFile(
      configPath,
      `${existing}${existing.endsWith("\n") || existing.length === 0 ? "" : "\n"}[core]\n\tsparseCheckout = true\n\tsparseCheckoutCone = true\n`,
      "utf8",
    );
  }
  await writeFile(join(dir, "info", "sparse-checkout"), "/*\n!/*/\n", "utf8");
  return "";
}

export async function sparseCheckoutSet(
  repositoryPath: string,
  paths: readonly string[],
): Promise<string> {
  await sparseCheckoutInitCone(repositoryPath);
  const lines = ["/*", "!/*/"];
  for (const raw of paths) {
    const path = raw.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const parts = path.split("/").filter((part) => part.length > 0);
    let prefix = "";
    for (let index = 0; index < parts.length; index += 1) {
      prefix = `${prefix}/${parts[index]}`;
      lines.push(`${prefix}/`);
      if (index < parts.length - 1) {
        lines.push(`!${prefix}/*/`);
      }
    }
  }
  await writeFile(join(gitDir(repositoryPath), "info", "sparse-checkout"), `${lines.join("\n")}\n`, "utf8");
  return "";
}

export function coneAllows(path: string, prefixes: readonly string[]): boolean {
  if (!path.includes("/")) {
    return true;
  }
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
