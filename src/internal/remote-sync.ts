import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { GritsError } from "../api/errors.js";
import { copyTree, isRemoteGitUrl, toLocalGitPath } from "./clone-local.js";
import { remoteUrl } from "./git-config.js";
import { readCommit } from "./git-object.js";
import { gitDir, resolveHead } from "./resolve-head.js";
import { resolveRevision, updateRef } from "./refs.js";
import { defaultFetch, type FetchLike } from "./smart-http-ls-remote.js";
import { fetchHttps } from "./smart-http-fetch.js";
import { pushHttps } from "./smart-http-push.js";

function isHttpsGitUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export async function fetchUpstream(
  repositoryPath: string,
  remoteName: string,
  branch: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<string> {
  const url = await remoteUrl(repositoryPath, remoteName);
  if (isHttpsGitUrl(url)) {
    await fetchHttps(repositoryPath, url, fetchImpl);
    const tip = await resolveRevision(repositoryPath, `refs/remotes/${remoteName}/${branch}`);
    await writeFile(
      join(gitDir(repositoryPath), "FETCH_HEAD"),
      `${tip}\t\tbranch '${branch}' of ${url}\n`,
      "utf8",
    );
    return tip;
  }
  const originPath = await requireLocalRemote(repositoryPath, remoteName, "remote.fetchUpstream");
  const tip = await resolveRevision(originPath, `refs/heads/${branch}`);
  await copyTree(join(gitDir(originPath), "objects"), join(gitDir(repositoryPath), "objects"));
  await updateRef(repositoryPath, `refs/remotes/${remoteName}/${branch}`, tip);
  await writeFile(
    join(gitDir(repositoryPath), "FETCH_HEAD"),
    `${tip}\t\tbranch '${branch}' of ${url}\n`,
    "utf8",
  );
  return tip;
}

export async function pushFf(
  repositoryPath: string,
  remoteName: string,
  branch: string,
  sha: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<string> {
  const url = await remoteUrl(repositoryPath, remoteName);
  if (isHttpsGitUrl(url)) {
    await pushHttps(repositoryPath, url, fetchImpl);
    return "";
  }
  const originPath = await requireLocalRemote(repositoryPath, remoteName, "remote.pushFf");
  await refuseCheckedOutBranch(originPath, branch, "remote.pushFf");
  const oid = sha.length === 0 ? await resolveHead(repositoryPath) : sha;
  const remoteTip = await readBranchTip(originPath, branch);
  if (remoteTip !== null && remoteTip !== oid) {
    await copyTree(join(gitDir(originPath), "objects"), join(gitDir(repositoryPath), "objects"));
    if (!(await isAncestor(repositoryPath, remoteTip, oid))) {
      throw new GritsError(
        "INVALID_CONFIG",
        `non-fast-forward: ${branch} at ${remoteTip} is not an ancestor of ${oid}.`,
        "remote.pushFf",
      );
    }
  }
  await copyTree(join(gitDir(repositoryPath), "objects"), join(gitDir(originPath), "objects"));
  await updateRef(originPath, `refs/heads/${branch}`, oid);
  return "";
}

export async function pushForceWithLease(
  repositoryPath: string,
  remoteName: string,
  branch: string,
  sha: string,
  expectedOld: string,
): Promise<string> {
  const originPath = await requireLocalRemote(
    repositoryPath,
    remoteName,
    "remote.pushForceWithLease",
  );
  if (!/^[0-9a-f]{40}$/i.test(expectedOld)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "pushForceWithLease requires oldId as the expected remote oid.",
      "remote.pushForceWithLease",
    );
  }
  await refuseCheckedOutBranch(originPath, branch, "remote.pushForceWithLease");
  const oid = sha.length === 0 ? await resolveHead(repositoryPath) : sha;
  const remoteTip = await readBranchTip(originPath, branch);
  if (remoteTip === null || remoteTip !== expectedOld.toLowerCase()) {
    throw new GritsError(
      "INVALID_CONFIG",
      "stale info: remote ref does not match oldId.",
      "remote.pushForceWithLease",
    );
  }
  await copyTree(join(gitDir(repositoryPath), "objects"), join(gitDir(originPath), "objects"));
  await updateRef(originPath, `refs/heads/${branch}`, oid);
  return "";
}

async function requireLocalRemote(
  repositoryPath: string,
  remoteName: string,
  slotId: string,
): Promise<string> {
  const url = toLocalGitPath(await remoteUrl(repositoryPath, remoteName));
  if (isRemoteGitUrl(url)) {
    throw new GritsError("NYI", `NYI: ${slotId} does not use network remotes.`, slotId);
  }
  if (!existsSync(url) || (!existsSync(join(url, ".git")) && !existsSync(join(url, "objects")))) {
    throw new GritsError("NOT_FOUND", `Local remote ${url} is not a git repository.`, slotId);
  }
  return url;
}

async function refuseCheckedOutBranch(
  originPath: string,
  branch: string,
  slotId: string,
): Promise<void> {
  if (gitDir(originPath) === originPath) {
    return;
  }
  const head = (await readFile(join(gitDir(originPath), "HEAD"), "utf8")).trim();
  const match = /^ref:\s*refs\/heads\/(.+)$/i.exec(head);
  if (match !== null && match[1] === branch) {
    throw new GritsError(
      "INVALID_CONFIG",
      `refusing to update checked out branch: refs/heads/${branch}`,
      slotId,
    );
  }
}

async function readBranchTip(originPath: string, branch: string): Promise<string | null> {
  try {
    return await resolveRevision(originPath, `refs/heads/${branch}`);
  } catch {
    return null;
  }
}

async function isAncestor(
  repositoryPath: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  if (ancestor === descendant) {
    return true;
  }
  const seen = new Set<string>();
  const stack = [descendant];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined || seen.has(current)) {
      continue;
    }
    seen.add(current);
    if (current === ancestor) {
      return true;
    }
    let commit;
    try {
      commit = await readCommit(repositoryPath, current);
    } catch {
      continue;
    }
    stack.push(...commit.parents);
  }
  return false;
}
