import { GritsError } from "../api/errors.js";
import type { GitObject, RepositoryDescriptor } from "../api/types.js";
import { FilesystemAdapter } from "../internal/filesystem-adapter.js";
import { MemoryAdapter } from "../internal/memory-adapter.js";
import type { RepositoryAdapter } from "../internal/adapter.js";
import { isNonEmptyString } from "../internal/runtime-type.js";
import { runPalSlot, type PalSlotContext } from "../internal/native-pal.js";

const PAL_SLOTS_BY_FAMILY = {
  objects: [
    "hashObjectStdin",
    "hashObjectForPath",
    "hashObjectNoWrite",
    "hashObjectForPathNoWrite",
    "hashObjectWriteBatch",
    "hashObjectWriteBatchAsync",
    "catBlob",
    "showBlob",
    "showBlobAsync",
  ],
  refs: [
    "updateRefCas",
    "fastForwardCheckout",
    "updateRef",
    "updateRefNoDeref",
    "remoteBranchesContaining",
    "deleteRef",
    "tagDelete",
    "tagCreate",
    "tagAnnotated",
    "tagList",
  ],
  index: [
    "readTree",
    "updateIndexCacheinfo",
    "updateIndexForceRemove",
    "updateIndexForceRemovePathspec",
    "updateIndexInfo",
    "writeTree",
    "statusPorcelain",
    "statusFull",
    "statusFullScoped",
    "stagedNames",
    "statusFullWithIgnored",
    "statusBranch",
    "statusBranchStream",
  ],
  commit: [
    "commitTree",
    "lsTreeNameOnly",
    "lsTreeNameOnlyZ",
    "lsTreeRecursiveZ",
    "lsTreePath",
    "lsTreeInfoZ",
    "mktree",
    "show",
    "logFormat",
    "revListParents",
    "catFileType",
  ],
  worktree: [
    "checkout",
    "checkoutDetach",
    "checkoutPath",
    "resetHard",
    "addDetach",
    "addNoCheckout",
    "sparseCheckoutInitCone",
    "sparseCheckoutSet",
    "removeForce",
    "move",
    "prune",
  ],
  history: [
    "revParse",
    "resolveCommit",
    "revListCount",
    "countCommits",
    "isAncestor",
    "firstCommit",
    "lookupBlobAt",
    "lookupBlobsAtBatch",
    "resolveRev",
    "splitPathRev",
    "mergeBase",
    "revListObjects",
    "objectSizes",
  ],
  merge: ["mergeFfOnly", "rebaseOnto", "rebaseAbort"],
  diff: [
    "nameStatusZ",
    "nameStatusZBetween",
    "noIndex",
    "unmergedNames",
    "cachedQuiet",
    "configShowOrigin",
  ],
  blame: ["porcelain", "revPath"],
  remote: ["originUrl", "fetchUpstream", "pushFf", "pushForceWithLease"],
  bootstrap: ["init", "clone", "connect"],
  repo: ["init", "clone", "connect"],
} as const;

export const palSlotToCanonicalOperation: Readonly<Record<string, string>> = Object.freeze({
  "objects.catBlob": "objects.read",
  "objects.showBlob": "objects.read",
  "objects.showBlobAsync": "objects.read",
  "history.resolveRev": "refs.resolve",
  "history.isAncestor": "history.isAncestor",
});

export const palSlotIds: readonly string[] = Object.freeze(
  Object.entries(PAL_SLOTS_BY_FAMILY).flatMap(([family, members]) =>
    members.map((member) => `${family}.${member}`),
  ).sort(),
);

export const mappedPalSlotIds: readonly string[] = Object.freeze(
  Object.keys(palSlotToCanonicalOperation).sort(),
);

export const nyiPalSlotIds: readonly string[] = Object.freeze(
  palSlotIds.filter((slotId) => palSlotToCanonicalOperation[slotId] === undefined),
);

export type GitContext = PalSlotContext & {
  repository?: RepositoryDescriptor;
};

type PalSlotsByFamily = typeof PAL_SLOTS_BY_FAMILY;

export type GitCommand = (context?: GitContext) => Promise<string>;

export type Git = {
  readonly [Command in PalSlotsByFamily[keyof PalSlotsByFamily][number]]: GitCommand;
};

function repositoryFromContext(context: GitContext): RepositoryDescriptor | undefined {
  if (context.repository !== undefined) {
    return context.repository;
  }
  if (isNonEmptyString(context.repositoryPath)) {
    return { kind: "filesystem", path: context.repositoryPath };
  }
  return undefined;
}

function gitObjectPayload(object: GitObject): string {
  if (object.kind === "blob") {
    return Buffer.from(object.bytes).toString("utf8");
  }
  if (object.kind === "tree") {
    return object.entries.map((entry) => `${entry.mode} ${entry.name} ${entry.objectId}`).join("\n");
  }
  return object.message;
}

async function runCanonical(
  adapter: RepositoryAdapter,
  canonical: string,
  slotId: string,
  context: GitContext,
): Promise<string> {
  if (canonical === "objects.read") {
    const id = context.rev ?? context.ref ?? context.newId;
    if (!isNonEmptyString(id)) {
      throw new GritsError("INVALID_CONFIG", "read requires a revision.", slotId);
    }
    return gitObjectPayload(await adapter.read(id));
  }
  if (canonical === "refs.resolve") {
    const name = context.ref ?? context.rev ?? "HEAD";
    const resolved = await adapter.resolve(name);
    return resolved === null ? "" : resolved.objectId;
  }
  const ancestor = context.rev ?? context.oldId;
  const descendant = context.otherRev ?? context.newId;
  if (!isNonEmptyString(ancestor) || !isNonEmptyString(descendant)) {
    throw new GritsError("INVALID_CONFIG", "isAncestor requires two revisions.", slotId);
  }
  return (await adapter.isAncestor(ancestor, descendant)) ? "true" : "false";
}

async function runGitCommand(slotId: string, context: GitContext): Promise<string> {
  const repository = repositoryFromContext(context);
  const canonical = palSlotToCanonicalOperation[slotId];
  if (canonical !== undefined) {
    if (repository === undefined) {
      throw new GritsError("INVALID_CONFIG", "This git command requires a repository.", slotId);
    }
    const adapter =
      repository.kind === "memory"
        ? new MemoryAdapter(repository.seed)
        : new FilesystemAdapter(repository.path);
    return runCanonical(adapter, canonical, slotId, context);
  }
  if (repository?.kind === "memory") {
    throw new GritsError(
      "UNSUPPORTED_CAPABILITY",
      "This git command is not supported on a memory repository.",
      slotId,
    );
  }
  const productionContext =
    repository?.kind === "filesystem"
      ? { ...context, repositoryPath: repository.path }
      : context;
  return runPalSlot(slotId, productionContext);
}

function createGit(): Git {
  const commands: Record<string, GitCommand> = {};
  // SAFETY: Object.keys of the `as const` family table is exactly keyof PalSlotsByFamily.
  for (const family of Object.keys(PAL_SLOTS_BY_FAMILY) as (keyof PalSlotsByFamily)[]) {
    if (family === "repo") {
      continue;
    }
    for (const member of PAL_SLOTS_BY_FAMILY[family]) {
      commands[member] = (context: GitContext = {}) => runGitCommand(`${String(family)}.${member}`, context);
    }
  }
  // SAFETY: keys are unique member names. repo init/clone/connect alias bootstrap.
  return Object.freeze(commands) as Git;
}

export const git: Git = createGit();

export async function invokePalSlot(
  slotId: string,
  context: PalSlotContext = {},
): Promise<string> {
  if (!nyiPalSlotIds.includes(slotId)) {
    throw new GritsError(
      "INVALID_CONFIG",
      "invokePalSlot only accepts NYI PAL slot IDs.",
      slotId,
    );
  }

  return runPalSlot(slotId, context);
}
