import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import {
  flattenTree,
  readCommit,
  writeLooseObject,
  writeTreeFromEntries,
  type ParsedCommit,
  type TreeEntry,
} from "./git-object.js";
import { gitDir, resolveHead } from "./resolve-head.js";
import { resolveRevision, updateRef } from "./refs.js";

export async function rebaseOnto(
  repositoryPath: string,
  newBase: string,
  oldBase: string,
  branch: string,
): Promise<string> {
  const onto = await resolveRevision(repositoryPath, newBase);
  const cutoff = await resolveRevision(repositoryPath, oldBase);
  const tip = await resolveRevision(repositoryPath, branch);
  const commits: string[] = [];
  let current = tip;
  while (current !== cutoff) {
    commits.push(current);
    const parsed = await readCommit(repositoryPath, current);
    if (parsed.parents.length === 0) {
      break;
    }
    current = parsed.parents[0];
  }
  commits.reverse();
  const origHead = await resolveHead(repositoryPath);
  const rebaseDir = join(gitDir(repositoryPath), "rebase-merge");
  await mkdir(rebaseDir, { recursive: true });
  await writeFile(join(gitDir(repositoryPath), "ORIG_HEAD"), `${origHead}\n`, "utf8");
  await writeFile(join(rebaseDir, "onto"), `${onto}\n`, "utf8");
  await writeFile(join(rebaseDir, "orig-head"), `${origHead}\n`, "utf8");
  await writeFile(join(rebaseDir, "head-name"), `${branch}\n`, "utf8");
  let baseTip = onto;
  for (const commitId of commits) {
    const commit = await readCommit(repositoryPath, commitId);
    const parent = commit.parents[0];
    const merged = await mergeTrees(
      repositoryPath,
      parent === undefined ? null : parent,
      baseTip,
      commitId,
    );
    if (merged.conflicts.length > 0) {
      await writeFile(join(rebaseDir, "stopped-sha"), `${commitId}\n`, "utf8");
      throw new GritsError(
        "INVALID_CONFIG",
        `rebase conflict: ${merged.conflicts.join(" ")}`,
        "merge.rebaseOnto",
      );
    }
    baseTip = await writeRebasedCommit(repositoryPath, commit, merged.tree, baseTip);
  }
  if (branch === "HEAD" || branch.startsWith("refs/")) {
    await updateRef(repositoryPath, branch === "HEAD" ? "HEAD" : branch, baseTip);
  } else {
    await updateRef(repositoryPath, `refs/heads/${branch}`, baseTip);
  }
  await rm(rebaseDir, { recursive: true, force: true });
  return "";
}

export async function rebaseAbort(repositoryPath: string): Promise<string> {
  const rebaseDir = join(gitDir(repositoryPath), "rebase-merge");
  const origPath = join(gitDir(repositoryPath), "ORIG_HEAD");
  if (!existsSync(rebaseDir) && !existsSync(origPath)) {
    throw new GritsError("INVALID_CONFIG", "No rebase in progress.", "merge.rebaseAbort");
  }
  if (existsSync(origPath)) {
    const orig = (await readFile(origPath, "utf8")).trim();
    await updateRef(repositoryPath, "HEAD", orig);
  }
  await rm(rebaseDir, { recursive: true, force: true });
  return "";
}

async function writeRebasedCommit(
  repositoryPath: string,
  commit: ParsedCommit,
  tree: string,
  parent: string,
): Promise<string> {
  const ident = `${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.tz}`;
  const payload = Buffer.from(
    `tree ${tree}\nparent ${parent}\nauthor ${ident}\ncommitter ${ident}\n\n${commit.message}`,
    "utf8",
  );
  return writeLooseObject(repositoryPath, "commit", payload);
}

async function mergeTrees(
  repositoryPath: string,
  base: string | null,
  ours: string,
  theirs: string,
): Promise<{ tree: string; conflicts: string[] }> {
  const baseMap = base === null ? new Map<string, TreeEntry>() : await treeMap(repositoryPath, base);
  const oursMap = await treeMap(repositoryPath, ours);
  const theirsMap = await treeMap(repositoryPath, theirs);
  const names = new Set([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()]);
  const entries: TreeEntry[] = [];
  const conflicts: string[] = [];
  for (const name of names) {
    const o = oursMap.get(name);
    const t = theirsMap.get(name);
    const b = baseMap.get(name);
    const oId = o?.id;
    const tId = t?.id;
    const bId = b?.id;
    if (oId === tId) {
      if (o !== undefined) {
        entries.push(o);
      }
      continue;
    }
    if (oId === bId) {
      if (t !== undefined) {
        entries.push(t);
      }
      continue;
    }
    if (tId === bId) {
      if (o !== undefined) {
        entries.push(o);
      }
      continue;
    }
    conflicts.push(name);
  }
  const nested = await writeNested(repositoryPath, entries);
  return { tree: nested, conflicts };
}

async function treeMap(repositoryPath: string, commitId: string): Promise<Map<string, TreeEntry>> {
  const commit = await readCommit(repositoryPath, commitId);
  const files = await flattenTree(repositoryPath, commit.tree);
  return new Map(files.map((file) => [file.name, file]));
}

async function writeNested(repositoryPath: string, files: readonly TreeEntry[]): Promise<string> {
  const root: TreeEntry[] = [];
  const dirs = new Map<string, TreeEntry[]>();
  for (const file of files) {
    const slash = file.name.indexOf("/");
    if (slash === -1) {
      root.push(file);
      continue;
    }
    const dir = file.name.slice(0, slash);
    const rest = file.name.slice(slash + 1);
    const nested = dirs.get(dir) ?? [];
    nested.push({ mode: file.mode, name: rest, id: file.id });
    dirs.set(dir, nested);
  }
  for (const [dir, nested] of dirs) {
    const id = await writeNested(repositoryPath, nested);
    root.push({ mode: "40000", name: dir, id });
  }
  return writeTreeFromEntries(repositoryPath, root);
}

