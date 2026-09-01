import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { GritsError } from "../api/errors.js";
import { blamePorcelain } from "./blame-porcelain.js";
import { configGet, originUrl } from "./git-config.js";
import {
  headTreeId,
  readCommit,
  readLooseObject,
  readTreeEntries,
  writeLooseObject,
  writeTreeFromEntries,
  type TreeEntry,
} from "./git-object.js";
import { readIndex, writeIndex } from "./git-index.js";
import { hashBlob } from "./hash-blob.js";
import { writeLooseBlob } from "./loose-object.js";
import {
  deleteRef,
  listRefNames,
  resolveRevision,
  updateRef,
  updateRefNoDeref,
} from "./refs.js";
import { gitDir, resolveHead } from "./resolve-head.js";

export type PalSlotContext = {
  repositoryPath?: string;
  stdin?: string;
  path?: string;
  paths?: readonly string[];
  ref?: string;
  rev?: string;
  otherRev?: string;
  name?: string;
  message?: string;
  oldId?: string;
  newId?: string;
  tree?: string;
  parents?: readonly string[];
  target?: string;
  dest?: string;
};

export async function runPalSlot(slotId: string, context: PalSlotContext): Promise<string> {
  switch (slotId) {
    case "objects.hashObjectStdin":
    case "objects.hashObjectForPath":
    case "objects.hashObjectNoWrite":
    case "objects.hashObjectForPathNoWrite":
    case "objects.hashObjectWriteBatch":
    case "objects.hashObjectWriteBatchAsync":
      return hashObjectSlot(slotId, context);
    case "refs.tagList":
      return tagList(requireRepo(slotId, context));
    case "refs.tagCreate":
      return tagCreate(requireRepo(slotId, context), requireName(slotId, context));
    case "refs.tagDelete":
      return tagDelete(requireRepo(slotId, context), requireName(slotId, context));
    case "refs.tagAnnotated":
      return tagAnnotated(
        requireRepo(slotId, context),
        requireName(slotId, context),
        context.message ?? "annotated",
      );
    case "refs.updateRef":
      await updateRef(
        requireRepo(slotId, context),
        context.ref ?? "HEAD",
        context.newId ?? (await resolveHead(requireRepo(slotId, context))),
      );
      return "";
    case "refs.updateRefNoDeref":
      await updateRefNoDeref(
        requireRepo(slotId, context),
        context.ref ?? "HEAD",
        context.newId ?? (await resolveHead(requireRepo(slotId, context))),
      );
      return "";
    case "refs.updateRefCas":
      return updateRefCas(slotId, context);
    case "refs.deleteRef":
      await deleteRef(requireRepo(slotId, context), context.ref ?? requireName(slotId, context));
      return "";
    case "refs.remoteBranchesContaining":
      return remoteBranchesContaining(requireRepo(slotId, context), context.rev);
    case "refs.fastForwardCheckout":
      return fastForwardCheckout(requireRepo(slotId, context), context.target ?? context.rev ?? "HEAD");
    case "index.writeTree":
      return writeTreeFromIndex(requireRepo(slotId, context));
    case "index.readTree":
      return readTreeIntoIndex(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "index.updateIndexForceRemove":
    case "index.updateIndexForceRemovePathspec":
      return removeFromIndex(requireRepo(slotId, context), requirePath(slotId, context));
    case "index.updateIndexCacheinfo":
      return updateIndexCacheinfo(slotId, context);
    case "index.updateIndexInfo":
      return updateIndexInfo(slotId, context);
    case "index.statusPorcelain":
      return statusPorcelain(requireRepo(slotId, context), { z: false, ignored: false, branch: false });
    case "index.statusFull":
    case "index.statusFullScoped":
      return statusPorcelain(requireRepo(slotId, context), {
        z: true,
        ignored: false,
        branch: false,
        pathspec: context.path,
      });
    case "index.statusFullWithIgnored":
      return statusPorcelain(requireRepo(slotId, context), { z: true, ignored: true, branch: false });
    case "index.stagedNames":
      return stagedNames(requireRepo(slotId, context));
    case "index.statusBranch":
    case "index.statusBranchStream":
      return statusPorcelain(requireRepo(slotId, context), { z: true, ignored: false, branch: true });
    case "commit.lsTreeNameOnly":
      return lsTree(requireRepo(slotId, context), context.rev ?? "HEAD", { nameOnly: true, z: false, recursive: false });
    case "commit.lsTreeNameOnlyZ":
      return lsTree(requireRepo(slotId, context), context.rev ?? "HEAD", { nameOnly: true, z: true, recursive: false });
    case "commit.lsTreeRecursiveZ":
      return lsTree(requireRepo(slotId, context), context.rev ?? "HEAD", { nameOnly: false, z: true, recursive: true });
    case "commit.lsTreePath":
      return lsTree(requireRepo(slotId, context), context.rev ?? "HEAD", {
        nameOnly: false,
        z: false,
        recursive: false,
        path: context.path,
      });
    case "commit.lsTreeInfoZ":
      return lsTree(requireRepo(slotId, context), context.rev ?? "HEAD", {
        nameOnly: false,
        z: true,
        recursive: false,
        path: context.path,
      });
    case "commit.catFileType":
      return catFileType(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "commit.show":
      return showCommit(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "commit.logFormat":
      return logSubject(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "commit.revListParents":
      return revListParents(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "commit.commitTree":
      return commitTree(slotId, context);
    case "commit.mktree":
      return mkTree(slotId, context);
    case "history.revParse":
    case "history.resolveCommit":
      return resolveRevision(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "history.revListCount":
    case "history.countCommits":
      return String((await listCommits(requireRepo(slotId, context), context.rev ?? "HEAD")).length);
    case "history.firstCommit":
      return firstCommit(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "history.lookupBlobAt":
    case "history.lookupBlobsAtBatch":
      return lookupBlobAt(requireRepo(slotId, context), context.rev ?? "HEAD", requirePath(slotId, context));
    case "history.splitPathRev":
      return splitPathRev(context.path ?? context.stdin ?? "");
    case "history.mergeBase":
      return mergeBase(
        requireRepo(slotId, context),
        context.rev ?? "HEAD^",
        context.otherRev ?? "HEAD",
      );
    case "history.revListObjects":
      return revListObjects(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "history.objectSizes":
      return objectSizes(requireRepo(slotId, context), context.rev ?? "HEAD");
    case "merge.mergeFfOnly":
      return mergeFfOnly(requireRepo(slotId, context), context.target ?? context.rev ?? "HEAD");
    case "diff.nameStatusZ":
    case "diff.nameStatusZBetween":
      return nameStatusZ(requireRepo(slotId, context), context.rev ?? "HEAD^", context.otherRev ?? "HEAD");
    case "diff.noIndex":
      return diffNoIndex(slotId, context);
    case "diff.unmergedNames":
      return "";
    case "diff.cachedQuiet":
      return diffCachedQuiet(requireRepo(slotId, context), context.path);
    case "diff.configShowOrigin":
      return configShowOrigin(requireRepo(slotId, context), context.path ?? "user.name");
    case "worktree.checkout":
    case "worktree.resetHard":
      return checkout(requireRepo(slotId, context), context.target ?? context.rev ?? "HEAD", false);
    case "worktree.checkoutDetach":
      return checkout(requireRepo(slotId, context), context.target ?? context.rev ?? "HEAD", true);
    case "worktree.checkoutPath":
      return checkoutPath(requireRepo(slotId, context), context.rev ?? "HEAD", requirePath(slotId, context));
    case "worktree.prune":
      return "";
    case "blame.porcelain":
      return blamePorcelain(requireRepo(slotId, context), context.path);
    case "blame.revPath":
      return blamePorcelain(requireRepo(slotId, context), requirePath(slotId, context));
    case "remote.originUrl":
      return originUrl(requireRepo(slotId, context));
    case "bootstrap.init":
    case "repo.init":
      return initRepository(requireRepo(slotId, context));
    case "bootstrap.connect":
    case "repo.connect":
      return resolveHead(requireRepo(slotId, context));
    case "bootstrap.clone":
    case "repo.clone":
    case "worktree.addDetach":
    case "worktree.addNoCheckout":
    case "worktree.sparseCheckoutInitCone":
    case "worktree.sparseCheckoutSet":
    case "worktree.removeForce":
    case "worktree.move":
    case "merge.rebaseOnto":
    case "merge.rebaseAbort":
    case "remote.fetchUpstream":
    case "remote.pushFf":
    case "remote.pushForceWithLease":
    case "system.selfUpdate":
    case "system.selfBuild":
    case "system.launchBrowserWindow":
      throw new GritsError("NYI", `NYI: ${slotId} is not implemented.`, slotId);
    default:
      throw new GritsError("NYI", `NYI: ${slotId} is not implemented.`, slotId);
  }
}

function requireRepo(slotId: string, context: PalSlotContext): string {
  if (typeof context.repositoryPath !== "string" || context.repositoryPath.length === 0) {
    throw new GritsError("INVALID_CONFIG", "invokePalSlot requires repositoryPath.", slotId);
  }
  return context.repositoryPath;
}

function requireName(slotId: string, context: PalSlotContext): string {
  if (typeof context.name !== "string" || context.name.length === 0) {
    throw new GritsError("INVALID_CONFIG", "invokePalSlot requires name.", slotId);
  }
  return context.name;
}

function requirePath(slotId: string, context: PalSlotContext): string {
  if (typeof context.path !== "string" || context.path.length === 0) {
    throw new GritsError("INVALID_CONFIG", "invokePalSlot requires path.", slotId);
  }
  return context.path;
}

async function hashObjectSlot(slotId: string, context: PalSlotContext): Promise<string> {
  if (typeof context.stdin !== "string") {
    throw new GritsError("INVALID_CONFIG", "invokePalSlot requires stdin for object hash slots.", slotId);
  }
  const content = Buffer.from(context.stdin);
  if (
    (slotId === "objects.hashObjectForPath" || slotId === "objects.hashObjectForPathNoWrite") &&
    typeof context.path === "string"
  ) {
    const fileBytes = await readFile(join(requireRepo(slotId, context), context.path));
    const id = hashBlob(fileBytes);
    if (slotId === "objects.hashObjectForPath") {
      await writeLooseBlob(requireRepo(slotId, context), fileBytes);
    }
    return id;
  }
  if (
    (slotId === "objects.hashObjectWriteBatch" || slotId === "objects.hashObjectWriteBatchAsync") &&
    context.paths !== undefined
  ) {
    const ids: string[] = [];
    for (const path of context.paths) {
      const fileBytes = await readFile(join(requireRepo(slotId, context), path));
      ids.push(await writeLooseBlob(requireRepo(slotId, context), fileBytes));
    }
    return ids.join("\n");
  }
  const id = hashBlob(content);
  if (
    slotId === "objects.hashObjectStdin" ||
    slotId === "objects.hashObjectForPath" ||
    slotId === "objects.hashObjectWriteBatch" ||
    slotId === "objects.hashObjectWriteBatchAsync"
  ) {
    if (typeof context.repositoryPath === "string" && context.repositoryPath.length > 0) {
      await writeLooseBlob(context.repositoryPath, content);
    }
  }
  return id;
}

async function tagList(repositoryPath: string): Promise<string> {
  const names = await listRefNames(repositoryPath, "refs/tags");
  const short = names.map((name) => name.slice("refs/tags/".length));
  return short.length === 0 ? "" : `${short.join("\n")}\n`;
}

async function tagCreate(repositoryPath: string, name: string): Promise<string> {
  await updateRef(repositoryPath, `refs/tags/${name}`, await resolveHead(repositoryPath));
  return "";
}

async function tagDelete(repositoryPath: string, name: string): Promise<string> {
  await deleteRef(repositoryPath, `refs/tags/${name}`);
  return "";
}

async function tagAnnotated(repositoryPath: string, name: string, message: string): Promise<string> {
  const head = await resolveHead(repositoryPath);
  const commit = await readCommit(repositoryPath, head);
  const ident = `${commit.author.name} <${commit.author.email}> ${commit.author.timestamp} ${commit.author.tz}`;
  const payload = Buffer.from(
    `object ${head}\ntype commit\ntag ${name}\ntagger ${ident}\n\n${message}\n`,
    "utf8",
  );
  const id = await writeLooseObject(repositoryPath, "tag", payload);
  await updateRef(repositoryPath, `refs/tags/${name}`, id);
  return "";
}

async function updateRefCas(slotId: string, context: PalSlotContext): Promise<string> {
  const repositoryPath = requireRepo(slotId, context);
  const refName = context.ref ?? "HEAD";
  const expected = context.oldId ?? (await resolveRevision(repositoryPath, refName));
  const current = await resolveRevision(repositoryPath, refName);
  if (current !== expected) {
    throw new GritsError("INVALID_CONFIG", "update-ref CAS failed.", slotId);
  }
  await updateRef(repositoryPath, refName, context.newId ?? current);
  return "";
}

async function remoteBranchesContaining(repositoryPath: string, rev?: string): Promise<string> {
  const commitId = await resolveRevision(repositoryPath, rev ?? "HEAD");
  const names = await listRefNames(repositoryPath, "refs/remotes");
  const hits: string[] = [];
  for (const name of names) {
    const tip = await resolveRevision(repositoryPath, name);
    const ancestors = await listCommits(repositoryPath, name);
    if (ancestors.includes(commitId) || tip === commitId) {
      hits.push(name.slice("refs/remotes/".length));
    }
  }
  return hits.length === 0 ? "" : `${hits.join("\n")}\n`;
}

async function fastForwardCheckout(repositoryPath: string, target: string): Promise<string> {
  const head = await resolveHead(repositoryPath);
  const dest = await resolveRevision(repositoryPath, target);
  const ancestors = await listCommits(repositoryPath, dest);
  if (!ancestors.includes(head) && head !== dest) {
    throw new GritsError("INVALID_CONFIG", "not a fast-forward", "refs.fastForwardCheckout");
  }
  return checkout(repositoryPath, dest, false);
}

async function writeTreeFromIndex(repositoryPath: string): Promise<string> {
  const entries = await readIndex(repositoryPath);
  return writeNestedTree(
    repositoryPath,
    entries.map((entry) => ({
      mode: entry.mode.toString(8),
      name: entry.name,
      id: entry.id,
    })),
  );
}

async function writeNestedTree(
  repositoryPath: string,
  files: readonly TreeEntry[],
): Promise<string> {
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
    const id = await writeNestedTree(repositoryPath, nested);
    root.push({ mode: "40000", name: dir, id });
  }
  return writeTreeFromEntries(repositoryPath, root);
}

async function readTreeIntoIndex(repositoryPath: string, rev: string): Promise<string> {
  const commitId = await resolveRevision(repositoryPath, rev);
  const commit = await readCommit(repositoryPath, commitId);
  const files = await flattenTree(repositoryPath, commit.tree, "");
  await writeIndex(
    repositoryPath,
    files.map((file) => ({
      mode: Number.parseInt(file.mode, 8),
      size: 0,
      id: file.id,
      name: file.name,
    })),
  );
  return commit.tree;
}

async function flattenTree(
  repositoryPath: string,
  treeId: string,
  prefix: string,
): Promise<TreeEntry[]> {
  const entries = await readTreeEntries(repositoryPath, treeId);
  const files: TreeEntry[] = [];
  for (const entry of entries) {
    const name = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
    if (entry.mode === "40000") {
      files.push(...(await flattenTree(repositoryPath, entry.id, name)));
    } else {
      files.push({ mode: entry.mode, name, id: entry.id });
    }
  }
  return files;
}

async function removeFromIndex(repositoryPath: string, path: string): Promise<string> {
  const entries = await readIndex(repositoryPath);
  await writeIndex(
    repositoryPath,
    entries.filter((entry) => entry.name !== path),
  );
  return writeTreeFromIndex(repositoryPath);
}

async function updateIndexCacheinfo(slotId: string, context: PalSlotContext): Promise<string> {
  const path = requirePath(slotId, context);
  const id = context.newId;
  if (typeof id !== "string" || !/^[0-9a-f]{40}$/i.test(id)) {
    throw new GritsError("INVALID_CONFIG", "updateIndexCacheinfo requires newId.", slotId);
  }
  return updateIndexInfo(slotId, {
    ...context,
    stdin: `100644 ${id.toLowerCase()}\t${path}\n`,
  });
}

async function updateIndexInfo(slotId: string, context: PalSlotContext): Promise<string> {
  const repositoryPath = requireRepo(slotId, context);
  const stdin = context.stdin ?? "";
  const entries = await readIndex(repositoryPath);
  for (const line of stdin.split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^(\d+) ([0-9a-f]{40})\t(.+)$/i.exec(line);
    if (match === null) {
      continue;
    }
    const name = match[3];
    const next = entries.filter((entry) => entry.name !== name);
    next.push({
      mode: Number.parseInt(match[1], 8),
      size: 0,
      id: match[2].toLowerCase(),
      name,
    });
    entries.length = 0;
    entries.push(...next);
  }
  await writeIndex(repositoryPath, entries);
  return writeTreeFromIndex(repositoryPath);
}

async function statusPorcelain(
  repositoryPath: string,
  options: { z: boolean; ignored: boolean; branch: boolean; pathspec?: string },
): Promise<string> {
  const entries = await readIndex(repositoryPath);
  const lines: string[] = [];
  if (options.branch) {
    const head = await resolveHead(repositoryPath);
    lines.push(`# branch.head ${await headBranchName(repositoryPath)}`);
    lines.push(`# branch.oid ${head}`);
  }
  for (const entry of entries) {
    if (options.pathspec !== undefined && !entry.name.startsWith(options.pathspec)) {
      continue;
    }
    const filePath = join(repositoryPath, entry.name);
    if (!existsSync(filePath)) {
      lines.push(` D ${entry.name}`);
      continue;
    }
    const bytes = await readFile(filePath);
    if (hashBlob(bytes) !== entry.id) {
      lines.push(` M ${entry.name}`);
    }
  }
  const indexed = new Set(entries.map((entry) => entry.name));
  for (const file of await listWorktreeFiles(repositoryPath)) {
    if (indexed.has(file)) {
      continue;
    }
    if (options.pathspec !== undefined && !file.startsWith(options.pathspec)) {
      continue;
    }
    lines.push(`?? ${file}`);
  }
  const sep = options.z ? "\0" : "\n";
  if (lines.length === 0) {
    return "";
  }
  return options.z ? `${lines.join("\0")}\0` : `${lines.join(sep)}\n`;
}

async function stagedNames(repositoryPath: string): Promise<string> {
  const index = await readIndex(repositoryPath);
  const treeId = await headTreeId(repositoryPath);
  const headFiles = new Map(
    (await flattenTree(repositoryPath, treeId, "")).map((entry) => [entry.name, entry.id]),
  );
  const names = index
    .filter((entry) => headFiles.get(entry.name) !== entry.id)
    .map((entry) => entry.name);
  return names.length === 0 ? "" : `${names.join("\0")}\0`;
}

async function lsTree(
  repositoryPath: string,
  rev: string,
  options: { nameOnly: boolean; z: boolean; recursive: boolean; path?: string },
): Promise<string> {
  const commitId = await resolveRevision(repositoryPath, rev);
  const object = await readLooseObject(repositoryPath, commitId);
  const treeId = object.type === "commit" ? (await readCommit(repositoryPath, commitId)).tree : commitId;
  const entries = options.recursive
    ? await flattenTree(repositoryPath, treeId, "")
    : await readTreeEntries(repositoryPath, treeId);
  const filtered =
    options.path === undefined ? entries : entries.filter((entry) => entry.name === options.path);
  const sep = options.z ? "\0" : "\n";
  const lines = filtered.map((entry) => {
    if (options.nameOnly) {
      return entry.name;
    }
    const type = entry.mode === "40000" ? "tree" : "blob";
    const mode = entry.mode.padStart(6, "0");
    return `${mode} ${type} ${entry.id}\t${entry.name}`;
  });
  if (lines.length === 0) {
    return "";
  }
  return options.z ? `${lines.join("\0")}\0` : `${lines.join(sep)}\n`;
}

async function catFileType(repositoryPath: string, rev: string): Promise<string> {
  const id = await resolveRevision(repositoryPath, rev);
  const object = await readLooseObject(repositoryPath, id);
  return `${object.type}\n`;
}

async function showCommit(repositoryPath: string, rev: string): Promise<string> {
  const id = await resolveRevision(repositoryPath, rev);
  const commit = await readCommit(repositoryPath, id);
  return commit.message.endsWith("\n") ? commit.message : `${commit.message}\n`;
}

async function logSubject(repositoryPath: string, rev: string): Promise<string> {
  const id = await resolveRevision(repositoryPath, rev);
  const commit = await readCommit(repositoryPath, id);
  const subject = commit.message.replace(/\n+$/u, "").split("\n")[0];
  return `${subject}\n`;
}

async function revListParents(repositoryPath: string, rev: string): Promise<string> {
  const id = await resolveRevision(repositoryPath, rev);
  const commit = await readCommit(repositoryPath, id);
  return commit.parents.length === 0 ? `${id}\n` : `${id} ${commit.parents.join(" ")}\n`;
}

async function commitTree(slotId: string, context: PalSlotContext): Promise<string> {
  const repositoryPath = requireRepo(slotId, context);
  const tree = context.tree ?? (await writeTreeFromIndex(repositoryPath));
  const parents = context.parents ?? [await resolveHead(repositoryPath)];
  const message = context.message ?? "commit";
  const head = await readCommit(repositoryPath, await resolveHead(repositoryPath));
  const ident = `${head.author.name} <${head.author.email}> ${head.author.timestamp} ${head.author.tz}`;
  const parentLines = parents.map((parent) => `parent ${parent}`).join("\n");
  const payload = Buffer.from(
    `tree ${tree}\n${parentLines}${parentLines.length > 0 ? "\n" : ""}author ${ident}\ncommitter ${ident}\n\n${message}\n`,
    "utf8",
  );
  return writeLooseObject(repositoryPath, "commit", payload);
}

async function mkTree(slotId: string, context: PalSlotContext): Promise<string> {
  const repositoryPath = requireRepo(slotId, context);
  const entries: TreeEntry[] = [];
  for (const line of (context.stdin ?? "").split("\n")) {
    if (line.trim().length === 0) {
      continue;
    }
    const match = /^(\d+) (blob|tree) ([0-9a-f]{40})\t(.+)$/i.exec(line);
    if (match === null) {
      continue;
    }
    entries.push({ mode: match[1], name: match[4], id: match[3].toLowerCase() });
  }
  return writeTreeFromEntries(repositoryPath, entries);
}

async function listCommits(repositoryPath: string, rev: string): Promise<string[]> {
  const start = await resolveRevision(repositoryPath, rev);
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
    const commit = await readCommit(repositoryPath, id);
    queue.push(...commit.parents);
  }
  return ordered;
}

async function firstCommit(repositoryPath: string, rev: string): Promise<string> {
  const commits = await listCommits(repositoryPath, rev);
  return commits[commits.length - 1];
}

async function lookupBlobAt(repositoryPath: string, rev: string, path: string): Promise<string> {
  const commitId = await resolveRevision(repositoryPath, rev);
  const commit = await readCommit(repositoryPath, commitId);
  const files = await flattenTree(repositoryPath, commit.tree, "");
  const entry = files.find((file) => file.name === path);
  if (entry === undefined) {
    throw new GritsError("NOT_FOUND", `Path ${path} was not found.`, "history.lookupBlobAt");
  }
  return entry.id;
}

function splitPathRev(raw: string): string {
  const at = raw.lastIndexOf("@");
  if (at === -1) {
    return `${raw}\t`;
  }
  return `${raw.slice(0, at)}\t${raw.slice(at + 1)}`;
}

async function mergeBase(repositoryPath: string, left: string, right: string): Promise<string> {
  const leftCommits = new Set(await listCommits(repositoryPath, left));
  for (const id of await listCommits(repositoryPath, right)) {
    if (leftCommits.has(id)) {
      return id;
    }
  }
  throw new GritsError("NOT_FOUND", "No merge base.", "history.mergeBase");
}

async function revListObjects(repositoryPath: string, rev: string): Promise<string> {
  const commits = await listCommits(repositoryPath, rev);
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const commitId of commits) {
    if (!seen.has(commitId)) {
      lines.push(commitId);
      seen.add(commitId);
    }
    const commit = await readCommit(repositoryPath, commitId);
    if (!seen.has(commit.tree)) {
      lines.push(commit.tree);
      seen.add(commit.tree);
    }
    for (const file of await flattenTree(repositoryPath, commit.tree, "")) {
      if (!seen.has(file.id)) {
        lines.push(`${file.id} ${file.name}`);
        seen.add(file.id);
      }
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

async function objectSizes(repositoryPath: string, rev: string): Promise<string> {
  const id = await resolveRevision(repositoryPath, rev);
  const object = await readLooseObject(repositoryPath, id);
  return `${object.payload.byteLength}`;
}

async function mergeFfOnly(repositoryPath: string, target: string): Promise<string> {
  return fastForwardCheckout(repositoryPath, target);
}

async function nameStatusZ(repositoryPath: string, left: string, right: string): Promise<string> {
  const leftId = await resolveRevision(repositoryPath, left);
  const rightId = await resolveRevision(repositoryPath, right);
  const leftCommit = await readCommit(repositoryPath, leftId);
  const rightCommit = await readCommit(repositoryPath, rightId);
  const leftFiles = new Map(
    (await flattenTree(repositoryPath, leftCommit.tree, "")).map((entry) => [entry.name, entry.id]),
  );
  const rightFiles = new Map(
    (await flattenTree(repositoryPath, rightCommit.tree, "")).map((entry) => [entry.name, entry.id]),
  );
  const names = [...new Set([...leftFiles.keys(), ...rightFiles.keys()])].sort();
  const lines: string[] = [];
  for (const name of names) {
    const before = leftFiles.get(name);
    const after = rightFiles.get(name);
    if (before === undefined && after !== undefined) {
      lines.push(`A\0${name}`);
    } else if (before !== undefined && after === undefined) {
      lines.push(`D\0${name}`);
    } else if (before !== after) {
      lines.push(`M\0${name}`);
    }
  }
  return lines.length === 0 ? "" : `${lines.join("\0")}\0`;
}

async function diffNoIndex(slotId: string, context: PalSlotContext): Promise<string> {
  const repositoryPath = requireRepo(slotId, context);
  const left = context.path ?? "left.txt";
  const right = context.dest ?? context.otherRev ?? "right.txt";
  const leftBytes = await readFile(join(repositoryPath, left));
  const rightBytes = await readFile(join(repositoryPath, right));
  if (Buffer.compare(leftBytes, rightBytes) === 0) {
    return "";
  }
  return `M\t${left}\n`;
}

async function diffCachedQuiet(repositoryPath: string, path?: string): Promise<string> {
  const names = await stagedNames(repositoryPath);
  if (path !== undefined && !names.includes(path)) {
    return "";
  }
  return names.length === 0 ? "" : names;
}

async function configShowOrigin(repositoryPath: string, key: string): Promise<string> {
  const value = await configGet(repositoryPath, key);
  return `file:.git/config\t${value}\n`;
}

async function headBranchName(repositoryPath: string): Promise<string> {
  const raw = (await readFile(join(gitDir(repositoryPath), "HEAD"), "utf8")).trim();
  const match = /^ref:\s*refs\/heads\/(.+)$/i.exec(raw);
  return match === null ? "(detached)" : match[1];
}

async function listWorktreeFiles(root: string, relative = ""): Promise<string[]> {
  const dir = relative.length === 0 ? root : join(root, relative);
  const names = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of names) {
    if (relative.length === 0 && entry.name === ".git") {
      continue;
    }
    const rel = relative.length === 0 ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listWorktreeFiles(root, rel)));
      continue;
    }
    files.push(rel.replaceAll("\\", "/"));
  }
  return files;
}

async function checkout(repositoryPath: string, target: string, detach: boolean): Promise<string> {
  const dest = await resolveRevision(repositoryPath, target);
  const commit = await readCommit(repositoryPath, dest);
  const files = await flattenTree(repositoryPath, commit.tree, "");
  for (const file of files) {
    const object = await readLooseObject(repositoryPath, file.id);
    const filePath = join(repositoryPath, file.name);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, object.payload);
  }
  if (detach) {
    await updateRefNoDeref(repositoryPath, "HEAD", dest);
  } else {
    await updateRef(repositoryPath, "HEAD", dest);
  }
  await writeIndex(
    repositoryPath,
    files.map((file) => ({
      mode: Number.parseInt(file.mode, 8),
      size: objectSize(file),
      id: file.id,
      name: file.name,
    })),
  );
  return "";
}

function objectSize(_file: TreeEntry): number {
  return 0;
}

async function checkoutPath(repositoryPath: string, rev: string, path: string): Promise<string> {
  const id = await lookupBlobAt(repositoryPath, rev, path);
  const object = await readLooseObject(repositoryPath, id);
  await writeFile(join(repositoryPath, path), object.payload);
  return "";
}

async function initRepository(repositoryPath: string): Promise<string> {
  const dir = gitDir(repositoryPath);
  await mkdir(join(dir, "objects"), { recursive: true });
  await mkdir(join(dir, "refs", "heads"), { recursive: true });
  await writeFile(join(dir, "HEAD"), "ref: refs/heads/master\n", "utf8");
  await writeFile(
    join(dir, "config"),
    "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n",
    "utf8",
  );
  return "";
}
